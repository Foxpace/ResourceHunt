import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReplay } from "../src/index.ts";
import { recordWorldReplay, corruptWorldReplay } from "./helpers/world-integration.ts";

for (const defect of [
  "out-of-bounds hazard",
  "oversized hazard footprint",
  "negative drone health",
  "oversized guardian health",
  "out-of-bounds guardian position",
  "oversized cargo",
  "duplicate drone IDs",
  "foreign guard owner",
  "out-of-bounds route",
  "missing frame world",
  "invalid hazard timing",
  "orphaned sabotage progress",
  "foreign saboteur",
  "negative depot downtime",
  "negative sabotage cooldown",
  "nonnumeric sabotage progress",
]) {
  test(`replay validation rejects ${defect}`, async (context) => {
    // Given
    const original = await recordWorldReplay(context);
    const replay = corruptWorldReplay(original, defect);

    // When
    const importReplay = () => parseReplay(replay);

    // Then
    assert.throws(importReplay, /Invalid replay/);
  });
}

test("larger natural event footprints survive JSON replay export and import", async (context) => {
  // Given
  const original = await recordWorldReplay(context);
  const cells = original.initial.world.hazards[0]!.cells;

  // When
  const imported = parseReplay(JSON.parse(JSON.stringify(original)));

  // Then
  assert.ok(cells.length > 13);
  assert.deepEqual(imported.initial.world.hazards[0]!.cells, cells);
});
