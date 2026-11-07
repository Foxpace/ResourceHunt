import { test } from "node:test";
import assert from "node:assert/strict";
import { runStructureCheck, createTestSource } from "./helpers/structure-check.ts";

const invalidSources = [
  {
    name: "four function parameters",
    source: "function act(first, second, third, fourth) {}",
    error: /more than three parameters/,
  },
  {
    name: "four constructor parameters",
    source: "class Bot { constructor(first, second, third, fourth) {} }",
    error: /more than three parameters/,
  },
  {
    name: "four callback parameters",
    source: "const callback = (first, second, third, fourth) => {};",
    error: /more than three parameters/,
  },
  {
    name: "four interface parameters",
    source:
      "interface Bot { act(first: number, second: number, third: number, fourth: number): void }",
    error: /more than three parameters/,
  },
  {
    name: "four function-type parameters",
    source:
      "type Handler = (first: number, second: number, third: number, fourth: number) => void;",
    error: /more than three parameters/,
  },
  { name: "multiline if conditions", source: "if (\ntrue\n) {}", error: /one line/ },
  {
    name: "an if closing parenthesis on its own line",
    source: "if (true\n) {}",
    error: /one line/,
  },
  {
    name: "unnamed compound conditions",
    source: "if (count > 0 && count < 3) {}",
    error: /named local booleans/,
  },
  {
    name: "four boolean terms",
    source: "if (first && second && third && fourth) {}",
    error: /three boolean terms/,
  },
  {
    name: "an imported condition term",
    source: "import { ready } from './bot'; const hasCargo = true; if (ready && hasCargo) {}",
    error: /named local booleans/,
  },
  {
    name: "an outer module binding used as a local condition",
    source: "const ready = true; function act(hasCargo: boolean) { if (ready && hasCargo) {} }",
    error: /named local booleans/,
  },
  {
    name: "a number used as a boolean condition term",
    source: "function act(cargoCount: number, ready: boolean) { if (cargoCount && ready) {} }",
    error: /named local booleans/,
  },
  {
    name: "an untyped value used as a boolean condition term",
    source: "function act(cargo: any, ready: boolean) { if (cargo && ready) {} }",
    error: /named local booleans/,
  },
  {
    name: "a single-letter boolean condition term",
    source: "function act(x: boolean, ready: boolean) { if (x && ready) {} }",
    error: /named local booleans/,
  },
  {
    name: "unnamed filter conditions",
    source: "items.filter(item => item.active && item.score > 0);",
    error: /collection predicate/,
  },
  {
    name: "unnamed block predicate conditions",
    source: "items.find(item => { return item.active && item.score > 0; });",
    error: /collection predicate/,
  },
  {
    name: "unnamed compound ternary conditions",
    source: "const action = bot.active && bot.score > 0 ? 'move' : 'skip';",
    error: /ternary must use at most three named booleans/,
  },
  {
    name: "unnamed conditions inside a negated group",
    source: "if (!(bot.active && bot.score > 0)) {}",
    error: /named local booleans/,
  },
  {
    name: "unnamed conditions in nested predicate returns",
    source: "items.find(function (item) { if (item) return item.active && item.score > 0; });",
    error: /collection predicate/,
  },
  {
    name: "four named predicate terms",
    source: "items.some(item => { return ready && active && nearby && exposed; });",
    error: /collection predicate/,
  },
  {
    name: "three nesting levels at module scope",
    source: "if (first) { if (second) { if (third) {} } }",
    error: /nesting exceeds two/,
  },
  {
    name: "three nesting levels in a method",
    source: "function act() { if (first) { if (second) { if (third) {} } } }",
    error: /nesting exceeds two/,
  },
];
for (const scenario of invalidSources) {
  test(`the structure checker rejects ${scenario.name}`, async () => {
    // Given
    const source = scenario.source;

    // When
    const check = runStructureCheck("src/invalid.ts", source);

    // Then
    await assert.rejects(check, scenario.error);
  });
}

for (const source of [
  "function act(state, target, options) {}",
  "const ready = true, hasCargo = true; if (ready && hasCargo) {}",
  "function act(ready: boolean, hasCargo: boolean) { if (ready && !hasCargo) {} }",
  "items.filter((item: { active: boolean; score: number }) => { const active = item.active; const valuable = item.score > 0; return active && valuable; });",
  "items.every(item => item.active);",
  "items.sort((first, second) => first.score - second.score || first.id.localeCompare(second.id));",
  ["function act() {", ...Array<string>(28).fill(""), "}"].join("\n"),
]) {
  test(`the structure checker accepts valid code: ${source.split("\n")[0]}`, async () => {
    // Given
    const validSource = source;

    // When
    const check = runStructureCheck("src/valid.ts", validSource);

    // Then
    await assert.doesNotReject(check);
  });
}

for (const filePath of ["src/invalid.ts", "tests/helpers/invalid.ts", ".github/invalid.mjs"]) {
  test(`blank lines count toward the method limit in ${filePath}`, async () => {
    // Given
    const source = ["function act() {", ...Array<string>(29).fill(""), "}"].join("\n");

    // When
    const check = runStructureCheck(filePath, source);

    // Then
    await assert.rejects(check, /31 lines/);
  });
}

test("the structure checker reports the HTML line for an inline script", async () => {
  // Given
  const source = "<!doctype html>\n<script>\nif (count > 0 && count < 3) {}\n</script>";

  // When
  const check = runStructureCheck("workshop-timer.html", source);

  // Then
  await assert.rejects(check, /workshop-timer\.html:3 .*named local booleans/);
});

for (const scenario of [
  { name: "a twenty-line test", source: createTestSource(20), error: undefined },
  { name: "a twenty-one-line test", source: createTestSource(21), error: /maximum is 20/ },
  {
    name: "missing phase comments",
    source: createTestSource(20, ["Given", "Then"]),
    error: /Given, When, Then/,
  },
  {
    name: "phases in the wrong order",
    source: createTestSource(20, ["Then", "When", "Given"]),
    error: /Given, When, Then/,
  },
]) {
  test(`test structure validates ${scenario.name}`, async () => {
    // Given
    const source = scenario.source;

    // When
    const check = runStructureCheck("tests/example.test.ts", source);

    // Then
    if (scenario.error) await assert.rejects(check, scenario.error);
    else await assert.doesNotReject(check);
  });
}
