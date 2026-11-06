import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT, STAGES, commandContext, decide, isApproved } from "./guard.mjs";

const DRAFT = "# Intention: comet\n\nStatus: draft\nApproved by:\n\n## Our idea\n";
const APPROVED = "# Artifact: comet\n\nStatus: approved\nApproved by: Jana (intent owner)\n";
const UPSTREAM = { design: 1, plan: 2, build: 3, review: 4 };

function workspace(approvedCount = 0) {
  const root = mkdtempSync(join(tmpdir(), "bot-workflow-"));
  const names = Object.values(STAGES).map((stage) => stage.artifact);
  mkdirSync(join(root, "bots/comet/_workflow"), { recursive: true });
  for (const name of names.slice(0, approvedCount)) {
    writeFileSync(join(root, "bots/comet/_workflow", name), APPROVED);
  }

  return root;
}

function create(path, content) {
  return { toolName: "create_file", toolArgs: { filePath: path, content } };
}

function terminal(command) {
  return { tool_name: "run_in_terminal", tool_input: { command } };
}

function assertDenied(result, reason) {
  assert.equal(result.permissionDecision, "deny");
  assert.match(result.permissionDecisionReason, reason);
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

test("build edits the bot entry and its folder after plan approval", () => {
  // Given
  const root = workspace(3);
  const paths = ["bots/comet.ts", "bots/comet/_targets.ts", "bots/comet/targets.test.ts"];

  // When
  const results = paths.map((path) => decide(create(path, "x"), { root, stage: "build" }));

  // Then
  assert.deepEqual(results, [{}, {}, {}]);
});

test("build cannot edit code before the plan is approved", () => {
  // Given
  const root = workspace(2);
  writeFileSync(join(root, "bots/comet/_workflow/PLAN.md"), DRAFT);

  // When
  const result = decide(create("bots/comet.ts", "x"), { root, stage: "build" });

  // Then
  assertDenied(result, /PLAN\.md is not approved yet/);
});

test("build cannot edit game source, shared helpers, or other bots", () => {
  // Given
  const root = workspace(3);
  const paths = ["src/sdk.ts", "bots/_shared.ts", "bots/nearest.ts", "tests/game.test.ts"];

  // When
  const results = paths.map((path) => decide(create(path, "x"), { root, stage: "build" }));

  // Then
  for (const result of results) assert.equal(result.permissionDecision, "deny");
});

test("review cannot change bot code", () => {
  // Given
  const root = workspace(4);

  // When
  const result = decide(create("bots/comet.ts", "x"), { root, stage: "review" });

  // Then
  assertDenied(result, /Only Bot Build/);
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
  assertDenied(result, /protected/);
});

test("the terminal accepts only the runner for the current stage", () => {
  // Given
  const root = workspace(3);
  const commands = ["yarn test", "node .github/bot-workflow/run.mjs review comet bench"];

  // When
  const results = commands.map((command) => decide(terminal(command), { root, stage: "build" }));

  // Then
  assertDenied(results[0], /Run checks only through/);
  assertDenied(results[1], /only the build stage/);
});

test("the holdout check is reserved for review", () => {
  // Given
  const root = workspace(4);
  const command = "node .github/bot-workflow/run.mjs build comet holdout";

  // When
  const result = decide(terminal(command), { root, stage: "build" });

  // Then
  assertDenied(result, /Available in build: .*bench/);
});

test("runner commands may start from the workspace folder", () => {
  // Given
  const root = workspace(4);
  const command = `cd "${root}" && node .github/bot-workflow/run.mjs review comet holdout forest`;

  // When
  const context = commandContext(command, { root, stage: "review" });

  // Then
  assert.deepEqual([context.bot, context.operation, context.biome], ["comet", "holdout", "forest"]);
});

test("status and baseline run before any artifact exists", () => {
  // Given
  const root = workspace();
  const commands = ["status", "baseline"].map(
    (op) => `node .github/bot-workflow/run.mjs plan comet ${op}`,
  );

  // When
  const results = commands.map((command) => decide(terminal(command), { root, stage: "plan" }));

  // Then
  assert.deepEqual(results, [{}, {}]);
});

test("reading is allowed and unknown tools are blocked", () => {
  // Given
  const context = { root: workspace(), stage: "intention" };

  // When
  const read = decide({ toolName: "read_file", toolArgs: { filePath: "src/sdk.ts" } }, context);
  const unknown = decide({ toolName: "runSubagent", toolArgs: {} }, context);

  // Then
  assert.deepEqual(read, {});
  assertDenied(unknown, /Unknown tools/);
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
  const files = readdirSync(join(ROOT, ".github/agents")).filter((name) => name.endsWith(".md"));
  const sources = files.map((name) => readFileSync(join(ROOT, ".github/agents", name), "utf8"));
  const names = sources.map((source) => source.match(/^name: "(.+)"$/m)[1]);

  // When
  const targets = sources.flatMap((source) =>
    [...source.matchAll(/agent: "(.+)"$/gm)].map((m) => m[1]),
  );

  // Then
  assert.deepEqual(
    files.sort(),
    Object.keys(STAGES)
      .map((stage) => `bot-${stage}.agent.md`)
      .sort(),
  );
  for (const target of targets) assert.ok(names.includes(target), target);
});

test("agent instructions never forbid writing a draft", () => {
  // Given
  const folder = join(ROOT, ".github/agents");
  const files = readdirSync(folder).filter((name) => name.endsWith(".md"));

  // When
  const sources = files.map((name) => readFileSync(join(folder, name), "utf8"));

  // Then
  for (const source of sources)
    assert.doesNotMatch(source, /complete-proposal|no draft|before explicit/i);
});

test("every agent addresses the people at the keyboard by role", () => {
  // Given
  const folder = join(ROOT, ".github/agents");
  const files = readdirSync(folder).filter((name) => name.endsWith(".md"));

  // When
  const sources = files.map((name) => readFileSync(join(folder, name), "utf8"));

  // Then
  for (const source of sources)
    assert.match(source, /Talk to the three people[\s\S]*Every question starts with its role/);
});

test("every agent asks each of the three roles at least twice, and equally often", () => {
  // Given
  const folder = join(ROOT, ".github/agents");
  const files = readdirSync(folder).filter((name) => name.endsWith(".md"));

  // When
  const sources = files.map((name) => readFileSync(join(folder, name), "utf8"));

  // Then
  for (const source of sources) {
    const checklist = source.split("## Every role speaks")[1]?.split("\n## ")[0] ?? "";
    const counts = ["Intent owner", "Orchestrator", "Risk owner"].map(
      (role) => checklist.split(`- "**${role}:**`).length - 1,
    );
    assert.ok(Math.min(...counts) >= 2, counts.join());
    assert.equal(Math.max(...counts), Math.min(...counts), counts.join());
  }
});
