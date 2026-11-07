import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ROOT, STAGES, decide, isApproved } from "./guard.mjs";
import { parseRequest, run } from "./run.mjs";

const DRAFT = "# Intention: comet\n\nStatus: draft\nApproved by:\n\n## Our idea\n";
const APPROVED = "# Artifact: comet\n\nStatus: approved\nApproved by: Jana (intent owner)\n";
const UPSTREAM = { design: 1, plan: 2, build: 3, review: 4 };
const AGENTS = join(ROOT, ".github/agents");
const HANDIN_ZIP = "results/comet-handin.zip";
const PRACTICE_BOT = "bots/comet-thief.ts";
const OTHER_TEAM_BOT = "bots/comet-fox.ts";

function workspace(approvedCount = 0) {
  const root = mkdtempSync(join(tmpdir(), "bot-workflow-"));
  const names = Object.values(STAGES).map((stage) => stage.artifact);
  mkdirSync(join(root, "bots/comet/_workflow"), { recursive: true });
  for (const name of names.slice(0, approvedCount)) {
    writeFileSync(join(root, "bots/comet/_workflow", name), APPROVED);
  }

  return root;
}

function create(path, content = "x") {
  return { toolName: "create_file", toolArgs: { filePath: path, content } };
}

function assertDenied(result, reason) {
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, reason);
}

function agentSources() {
  const files = readdirSync(AGENTS).filter((name) => name.endsWith(".agent.md"));

  return files.map((name) => ({ name, source: readFileSync(join(AGENTS, name), "utf8") }));
}

function handInWorkspace(t, typecheckStatus = 0) {
  const root = workspace(5);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    "bots/comet.ts": "// Final bot\n",
    [PRACTICE_BOT]: "// Practice bot\n",
    [OTHER_TEAM_BOT]: "// Another team's bot\n",
    "bots/comet-fox/_workflow/INTENTION.md": APPROVED,
    "src/cli.ts":
      'console.log("comet Comet\\ncomet-thief Thief");\n' +
      'console.error("Bot skipped: comet-fox.ts: fixture error");\n',
    "node_modules/tsx/index.js": "",
    "node_modules/typescript/bin/tsc": `process.exitCode = ${typecheckStatus};`,
    "scripts/check-structure.mjs": "",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }

  return root;
}

function assertPracticeAndOtherTeamIntact(root) {
  assert.equal(readFileSync(join(root, PRACTICE_BOT), "utf8"), "// Practice bot\n");
  assert.equal(readFileSync(join(root, OTHER_TEAM_BOT), "utf8"), "// Another team's bot\n");
}

test("intention writes its own draft artifact without prerequisites", () => {
  // Given
  const root = workspace();

  // When
  const result = decide(create("bots/comet/_workflow/INTENTION.md", DRAFT), {
    root,
    stage: "intention",
  });

  // Then
  assert.deepEqual(result, {});
});

test("an agent may record an approval it was given", () => {
  // Given
  const root = workspace(3);
  const content = APPROVED.replace("Jana (intent owner)", "orchestrator, approved in chat");

  // When
  const result = decide(create("bots/comet/_workflow/BUILD.md", content), {
    root,
    stage: "build",
  });

  // Then
  assert.deepEqual(result, {});
});

test("design waits for an approved intention", () => {
  // Given
  const root = workspace();
  writeFileSync(join(root, "bots/comet/_workflow/INTENTION.md"), DRAFT);

  // When
  const result = decide(create("bots/comet/_workflow/DESIGN.md", DRAFT), {
    root,
    stage: "design",
  });

  // Then
  assertDenied(result, /INTENTION\.md is not approved yet/);
});

test("design cannot start without an intention", () => {
  // Given
  const root = workspace();

  // When
  const result = decide(create("bots/comet/_workflow/DESIGN.md", DRAFT), {
    root,
    stage: "design",
  });

  // Then
  assertDenied(result, /INTENTION\.md is missing/);
});

for (const [stage, approvedCount] of Object.entries(UPSTREAM)) {
  test(`${stage} may start once its upstream artifacts are approved`, () => {
    // Given
    const root = workspace(approvedCount);
    const path = `bots/comet/_workflow/${STAGES[stage].artifact}`;

    // When
    const result = decide(create(path, DRAFT), { root, stage });

    // Then
    assert.deepEqual(result, {}, stage);
  });
}

test("an agent cannot write another stage's artifact", () => {
  // Given
  const root = workspace(1);

  // When
  const result = decide(create("bots/comet/_workflow/PLAN.md", DRAFT), {
    root,
    stage: "design",
  });

  // Then
  assertDenied(result, /writes only DESIGN\.md/);
});

test("an agent may keep extra notes next to its artifact", () => {
  // Given
  const root = workspace(1);

  // When
  const result = decide(create("bots/comet/_workflow/ideas.md"), { root, stage: "design" });

  // Then
  assert.deepEqual(result, {});
});

test("build writes the final bot and its practice bots", () => {
  // Given
  const root = workspace(3);
  const paths = ["bots/comet.ts", "bots/comet-thief.ts"];

  // When
  const results = paths.map((path) => decide(create(path), { root, stage: "build" }));

  // Then
  assert.deepEqual(results, [{}, {}]);
});

test("build may rewrite the upstream artifacts during a pivot", () => {
  // Given
  const root = workspace(3);
  const names = ["INTENTION.md", "DESIGN.md", "PLAN.md"];

  // When
  const results = names.map((name) =>
    decide(create(`bots/comet/_workflow/${name}`, DRAFT), { root, stage: "build" }),
  );

  // Then
  assert.deepEqual(results, [{}, {}, {}]);
});

test("after a pivot, bot code waits until the artifacts are approved again", () => {
  // Given
  const root = workspace(3);
  writeFileSync(join(root, "bots/comet/_workflow/INTENTION.md"), DRAFT);

  // When
  const result = decide(create("bots/comet.ts"), { root, stage: "build" });

  // Then
  assertDenied(result, /INTENTION\.md is not approved yet/);
});

test("build cannot edit code before the plan is approved", () => {
  // Given
  const root = workspace(2);
  writeFileSync(join(root, "bots/comet/_workflow/PLAN.md"), DRAFT);

  // When
  const result = decide(create("bots/comet.ts"), { root, stage: "build" });

  // Then
  assertDenied(result, /PLAN\.md is not approved yet/);
});

test("stages before build cannot write bot code", () => {
  // Given
  const root = workspace(2);

  // When
  const result = decide(create("bots/comet.ts"), { root, stage: "plan" });

  // Then
  assertDenied(result, /Only Bot Build writes/);
});

test("game source, the baseline bot, and unowned bots stay read-only", () => {
  // Given
  const root = workspace(3);
  const paths = ["src/sdk.ts", "tests/game.test.ts", "bots/nearest.ts", "bots/_shared.ts"];

  // When
  const results = paths.map((path) => decide(create(path), { root, stage: "build" }));

  // Then
  for (const result of results) assert.equal(result.permissionDecision, "deny");
});

test("hand-in never writes bot code", () => {
  // Given
  const root = workspace(4);
  const paths = ["bots/comet.ts", "bots/comet-drone-bait.ts"];

  // When
  const results = paths.map((path) => decide(create(path), { root, stage: "review" }));

  // Then
  for (const result of results) assertDenied(result, /Only Bot Build writes/);
});

test("multi-file replacements check every target", () => {
  // Given
  const root = workspace(3);
  const replacements = [
    { filePath: "bots/comet.ts", oldString: "a", newString: "b" },
    { filePath: "src/sdk.ts", oldString: "a", newString: "b" },
  ];

  // When
  const result = decide(
    { toolName: "multi_replace_string_in_file", toolArgs: { replacements } },
    { root, stage: "build" },
  );

  // Then
  assertDenied(result, /read-only/);
});

test("terminal commands, reading, and exploration subagents are allowed", () => {
  // Given
  const context = { root: workspace(), stage: "intention" };
  const events = [
    { tool_name: "run_in_terminal", tool_input: { command: "yarn bench --bots nearest" } },
    { toolName: "read_file", toolArgs: { filePath: "src/sdk.ts" } },
    { toolName: "runSubagent", toolArgs: { agentName: "Explore" } },
  ];

  // When
  const results = events.map((event) => decide(event, context));

  // Then
  assert.deepEqual(results, [{}, {}, {}]);
});

test("the runner keeps holdout maps for the end of the build", () => {
  // Given
  const root = workspace(2);

  // When
  const attempt = () => parseRequest(["plan", "comet", "holdout"], root);

  // Then
  assert.throws(attempt, /Available in plan: .*bench/);
});

test("practice tournaments and packing run only at hand-in", () => {
  // Given
  const root = workspace(3);

  // When
  const attempts = ["tournament", "pack"].map(
    (op) => () => parseRequest(["build", "comet", op], root),
  );

  // Then
  for (const attempt of attempts) assert.throws(attempt, /Available in build:/);
});

test("packing archives only the final bot and its team folder", (t) => {
  // Given
  const root = handInWorkspace(t);
  const context = { ...parseRequest(["review", "comet", "pack"], root), log: [] };

  // When
  const status = run(context);

  // Then
  assert.equal(status, 0);
  const zip = readFileSync(join(root, HANDIN_ZIP));
  assert.ok(zip.includes("bots/comet.ts"));
  assert.ok(zip.includes("bots/comet/_workflow/REVIEW.md"));
  assert.ok(!zip.includes(PRACTICE_BOT));
  assert.ok(!zip.includes(OTHER_TEAM_BOT));
  assertPracticeAndOtherTeamIntact(root);
});

test("failed pack checks leave both teams' bot files intact", (t) => {
  // Given
  const root = handInWorkspace(t, 1);
  const context = { ...parseRequest(["review", "comet", "pack"], root), log: [] };

  // When
  const status = run(context);

  // Then
  assert.equal(status, 1);
  assert.ok(!existsSync(join(root, HANDIN_ZIP)));
  assertPracticeAndOtherTeamIntact(root);
});

test("discovery checks distinguish practice bots from another team with the same prefix", (t) => {
  // Given
  const root = handInWorkspace(t);
  const context = { ...parseRequest(["review", "comet", "check"], root), log: [] };

  // When
  const status = run(context);

  // Then
  assert.equal(status, 0);
  assert.match(context.log.join("\n"), /local bots: comet-thief\)/);
});

test("the runner benches against chosen opponents on one biome", () => {
  // Given
  const root = workspace(3);
  const args = ["build", "comet", "bench", "forest", "--vs", "comet-thief,nearest"];

  // When
  const request = parseRequest(args, root);

  // Then
  assert.deepEqual(request.opponents, ["comet-thief", "nearest"]);
  assert.equal(request.biome, "forest");
});

test("the runner skips formatting when Prettier is absent", () => {
  // Given
  const root = workspace(3);
  const context = { ...parseRequest(["build", "comet", "format"], root), log: [] };

  // When
  const exitCode = run(context);

  // Then
  assert.equal(exitCode, 0);
  assert.match(context.log.join("\n"), /SKIP .*Prettier is unavailable/);
});

test("labels keep separate evidence files for repeated runs", () => {
  // Given
  const root = workspace(3);
  const command = ["build", "comet", "format", "--label"];

  // When
  for (const label of ["before", "after"]) {
    run({ ...parseRequest([...command, label], root), log: [] });
  }

  // Then
  const evidence = readdirSync(join(root, "bots/comet/_workflow/evidence"));
  assert.deepEqual(evidence.sort(), [
    "build-format.label-after.txt",
    "build-format.label-before.txt",
  ]);
});

test("status and baseline run before any artifact exists", () => {
  // Given
  const root = workspace();

  // When
  const requests = ["status", "baseline"].map((op) =>
    parseRequest(["intention", "comet", op], root),
  );

  // Then
  assert.deepEqual(
    requests.map((request) => request.operation),
    ["status", "baseline"],
  );
});

test("approval needs both the status and a signature", () => {
  // Given
  const unsigned = "Status: approved\nApproved by:\n";
  const signed = "> **Status:** approved\n> **Approved by:** Jana\n";

  // When
  const results = [isApproved(unsigned), isApproved(signed), isApproved(DRAFT)];

  // Then
  assert.deepEqual(results, [false, true, false]);
});

test("an approved Markdown table unlocks the next stage", () => {
  // Given
  const root = workspace();
  const content = "| **Status** | Approved |\n| **Approved by** | Jana |\n";
  writeFileSync(join(root, "bots/comet/_workflow/INTENTION.md"), content);

  // When
  const result = decide(create("bots/comet/_workflow/DESIGN.md"), { root, stage: "design" });

  // Then
  assert.deepEqual(result, {});
});

test("approval fields may be formatted as list items", () => {
  // Given
  const content = "- **Status** : `APPROVED`\n- _Approved by_ : **Jana**";

  // When
  const approved = isApproved(content);

  // Then
  assert.equal(approved, true);
});

test("an approval example in a code block does not unlock a stage", () => {
  // Given
  const content = "```markdown\nStatus: approved\nApproved by: Jana\n```\n";

  // When
  const approved = isApproved(content);

  // Then
  assert.equal(approved, false);
});

test("a placeholder is not an approval signature", () => {
  // Given
  const content = "Status: approved\nApproved by: TODO (team)\n";

  // When
  const approved = isApproved(content);

  // Then
  assert.equal(approved, false);
});

test("conflicting status fields do not unlock a stage", () => {
  // Given
  const content = "Status: draft\n- Status: approved\nApproved by: Jana\n";

  // When
  const approved = isApproved(content);

  // Then
  assert.equal(approved, false);
});

test("every stage agent runs its own guard and hands off to an existing agent", () => {
  // Given
  const agents = agentSources();
  const names = agents.map(({ source }) => source.match(/^name: "(.+)"$/m)[1]);

  // When
  const targets = agents.flatMap(({ source }) =>
    [...source.matchAll(/agent: "(.+)"$/gm)].map((m) => m[1]),
  );

  // Then
  const expected = Object.keys(STAGES).map((stage) => `bot-${stage}.agent.md`);
  assert.deepEqual(agents.map(({ name }) => name).sort(), expected.sort());
  for (const { name, source } of agents)
    assert.match(source, new RegExp(`guard\\.mjs ${name.slice(4, -9)}"`));
  for (const target of targets) assert.ok(names.includes(target), target);
});

test("agent instructions never forbid writing a draft", () => {
  // Given
  const agents = agentSources();

  // When
  const forbidding = agents.filter(({ source }) =>
    /complete-proposal|no draft|before explicit/i.test(source),
  );

  // Then
  assert.deepEqual(forbidding, []);
});

test("every agent loads the shared workshop rules", () => {
  // Given
  const agents = agentSources();

  // When
  const missing = agents.filter(
    ({ source }) => !source.includes("../instructions/bot-development.instructions.md"),
  );

  // Then
  assert.deepEqual(missing, []);
});

for (const { name, source } of agentSources()) {
  test(`${name} asks each role at least twice, and equally often`, () => {
    // Given
    const checklist = source.split("## Every role speaks")[1]?.split("\n## ")[0] ?? "";

    // When
    const counts = ["Intent owner", "Orchestrator", "Risk owner"].map(
      (role) => checklist.split(`- "**${role}:**`).length - 1,
    );

    // Then
    assert.ok(Math.min(...counts) >= 2, `${name}: ${counts.join()}`);
    assert.equal(Math.max(...counts), Math.min(...counts), `${name}: ${counts.join()}`);
  });
}

test("the workshop timer and the agents agree on names and minutes", () => {
  // Given
  const timer = readFileSync(join(ROOT, "workshop-timer.html"), "utf8");
  const phases = [...timer.matchAll(/min: (\d+),\s*agent: ["'](Bot [^"']+)["']/g)];
  const agents = agentSources().map(({ source }) => source);

  // When
  const matched = phases.filter(([, minutes, agent]) =>
    agents.some((source) => {
      const agentNameMatches = source.includes(`name: "${agent}"`);
      const agentMinutesMatch = source.includes(`about ${minutes} minutes`);
      return agentNameMatches && agentMinutesMatch;
    }),
  );

  // Then
  assert.equal(phases.length, Object.keys(STAGES).length);
  assert.equal(matched.length, phases.length);
});
