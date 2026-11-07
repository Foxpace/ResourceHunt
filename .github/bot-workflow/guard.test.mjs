import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, STAGES, decide, isApproved } from "./guard.mjs";
import { parseRequest } from "./run.mjs";

const DRAFT = "# Intention: comet\n\nStatus: draft\nApproved by:\n\n## Our idea\n";
const APPROVED = "# Artifact: comet\n\nStatus: approved\nApproved by: Jana (intent owner)\n";
const UPSTREAM = { design: 1, plan: 2, build: 3, review: 4 };
const AGENTS = join(ROOT, ".github/agents");

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

test("each stage may start once its upstream artifacts are approved", () => {
  for (const [stage, approvedCount] of Object.entries(UPSTREAM)) {
    // Given
    const root = workspace(approvedCount);
    const path = `bots/comet/_workflow/${STAGES[stage].artifact}`;

    // When
    const result = decide(create(path, DRAFT), { root, stage });

    // Then
    assert.deepEqual(result, {}, stage);
  }
});

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

test("every agent asks each of the three roles at least twice, and equally often", () => {
  for (const { name, source } of agentSources()) {
    // Given
    const checklist = source.split("## Every role speaks")[1]?.split("\n## ")[0] ?? "";

    // When
    const counts = ["Intent owner", "Orchestrator", "Risk owner"].map(
      (role) => checklist.split(`- "**${role}:**`).length - 1,
    );

    // Then
    assert.ok(Math.min(...counts) >= 2, `${name}: ${counts.join()}`);
    assert.equal(Math.max(...counts), Math.min(...counts), `${name}: ${counts.join()}`);
  }
});

test("the workshop timer and the agents agree on names and minutes", () => {
  // Given
  const timer = readFileSync(join(ROOT, "workshop-timer.html"), "utf8");
  const phases = [...timer.matchAll(/min: (\d+),\s*agent: ["'](Bot [^"']+)["']/g)];
  const agents = agentSources().map(({ source }) => source);

  // When
  const matched = phases.filter(([, minutes, agent]) =>
    agents.some(
      (source) =>
        source.includes(`name: "${agent}"`) && source.includes(`about ${minutes} minutes`),
    ),
  );

  // Then
  assert.equal(phases.length, Object.keys(STAGES).length);
  assert.equal(matched.length, phases.length);
});
