import { test } from "node:test";
import assert from "node:assert/strict";
import { manhattanDistance } from "../src/engine/grid.ts";
import { WorldScenario } from "./helpers/world-fixtures.ts";

function createWideWeatherScenario(distanceFromCenter = 5): WorldScenario {
  const scenario = new WorldScenario({ naturalEvents: true, seed: "wide-weather" });
  const center = scenario.state.hazards[0]!.center;
  scenario.attacker.position = { x: center.x, y: center.y - distanceFromCenter };

  return scenario;
}

test("natural events reach five tiles from their center and cover more than thirteen cells", () => {
  // Given
  const scenario = createWideWeatherScenario();

  // When
  const hazard = scenario.state.hazards[0]!;
  const distances = hazard.cells.map((cell) => manhattanDistance(cell, hazard.center));

  // Then
  assert.ok(hazard.cells.length > 13);
  assert.ok(hazard.cells.length <= 61);
  assert.equal(Math.max(...distances), 5);
});

test("an exposed bot five tiles from the event center spills cargo on impact", () => {
  // Given
  const scenario = createWideWeatherScenario();

  // When
  scenario.advanceTo(18);

  // Then
  assert.equal(scenario.attacker.inventory.length, 1);
  assert.equal(scenario.attacker.travelRemaining, 1);
  assert.equal(scenario.attacker.lost, 1);
});

test("a bot six tiles from the event center remains outside the impact", () => {
  // Given
  const scenario = createWideWeatherScenario(6);

  // When
  scenario.advanceTo(18);

  // Then
  assert.equal(scenario.attacker.inventory.length, 2);
  assert.equal(scenario.attacker.travelRemaining, 0);
});

test("guard still protects a bot at the outer edge of a larger impact", () => {
  // Given
  const scenario = createWideWeatherScenario();
  scenario.context.tick = 17;
  scenario.act({ type: "guard" });

  // When
  scenario.advanceTo(18);

  // Then
  assert.equal(scenario.attacker.inventory.length, 2);
  assert.equal(scenario.attacker.travelRemaining, 0);
});
