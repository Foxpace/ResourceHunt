import { test } from "node:test";
import assert from "node:assert/strict";
import { manhattanDistance } from "../src/engine/grid.ts";
import { DroneMinds, retireDrone } from "../src/engine/world/drone-minds.ts";
import { advanceScavengerDrones } from "../src/engine/world/scavenger-drones.ts";
import { protectDroneCrossing } from "../src/engine/world/bot-helpers.ts";
import { WorldScenario, createDrone } from "./helpers/world-fixtures.ts";

const HOME = { x: 6, y: 6 };

test("SDK guards before crossing a stationary drone with a ready attack", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.drones = [createDrone({ nextMoveTick: 99 })];
  // When
  const action = protectDroneCrossing(scenario.observe(), { type: "move", direction: "E" });
  // Then
  assert.deepEqual(action, { type: "guard" });
});

test("a waiting drone steals cargo from a bot on its tile without moving", () => {
  // Given
  const scenario = new WorldScenario();
  const drone = createDrone({ position: { ...scenario.defender.position }, nextMoveTick: 99 });
  scenario.state.drones = [drone];
  // When
  scenario.advanceTo(11);
  // Then
  assert.deepEqual(drone.inventory, ["crystal"]);
  assert.deepEqual(scenario.defender.inventory, ["relic"]);
  assert.equal(scenario.defender.lost, 1);
  assert.deepEqual(drone.position, scenario.defender.position);
  assert.equal(drone.nextMoveTick, 99);
});

test("a drone steals from the loaded bot when an empty bot shares its tile", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.attacker.inventory = [];
  scenario.attacker.position = scenario.defender.position;
  const drone = createDrone({ position: { x: 8, y: 6 } });
  scenario.state.drones = [drone];

  // When
  scenario.advanceTo(10);

  // Then
  assert.deepEqual(drone.inventory, ["crystal"]);
});

test("guard then move protects against the drone phase after crossing", () => {
  // Given
  const scenario = new WorldScenario();
  const drone = createDrone({ nextMoveTick: 99 });
  scenario.state.drones = [drone];
  scenario.advanceTo(10);
  scenario.act({ type: "guard" }, "defender");
  scenario.advanceTo(11);
  scenario.moveDefender(drone.position);

  // When
  scenario.advanceTo(12);

  // Then
  assert.equal(scenario.defender.lost, 0);
});

test("a waiting drone respects the attack cooldown", () => {
  // Given
  const scenario = new WorldScenario();
  const drone = createDrone({ position: { ...scenario.defender.position }, nextMoveTick: 99 });
  scenario.state.drones = [drone];
  scenario.advanceTo(11);
  // When
  scenario.advanceTo(12);
  // Then
  assert.deepEqual(drone.inventory, ["crystal"]);
  assert.equal(scenario.defender.lost, 1);
});

function createChaseScenario() {
  const scenario = new WorldScenario();
  const drone = createDrone({ nextMoveTick: 0 });
  scenario.state.drones = [drone];
  scenario.attacker.position = scenario.attacker.base;
  scenario.defender.position = { x: 11, y: 6 };
  const minds = new DroneMinds();
  const mind = minds.mindOf({ context: scenario.context, state: scenario.state }, drone);

  return { scenario, drone, minds, mind };
}

function runDrones(chase: ReturnType<typeof createChaseScenario>, ticks: number): number {
  const { scenario, drone, minds } = chase;
  let farthest = 0;

  for (let step = 0; step < ticks; step++) {
    scenario.context.tick++;
    advanceScavengerDrones({ context: scenario.context, state: scenario.state }, minds);
    farthest = Math.max(farthest, manhattanDistance(drone.position, HOME));
  }

  return farthest;
}

test("a drone gives up a chase once it strays past its leash", () => {
  // Given
  const chase = createChaseScenario();
  chase.mind.leash = 2;

  // When
  const farthest = runDrones(chase, 12);

  // Then
  assert.equal(farthest, 3);
  assert.equal(chase.scenario.defender.travelRemaining, 0);
  assert.equal(chase.scenario.defender.lost, 0);
});

test("a drone returns near its home after giving up", () => {
  // Given
  const chase = createChaseScenario();
  chase.mind.leash = 2;

  // When
  runDrones(chase, 12);

  // Then
  assert.ok(manhattanDistance(chase.drone.position, HOME) <= 3);
  assert.equal(chase.mind.pursuing, false);
});

test("a drone tries again after its retry delay", () => {
  // Given
  const chase = createChaseScenario();
  chase.mind.leash = 2;

  // When
  runDrones(chase, 80);

  // Then
  assert.ok(chase.scenario.defender.lost > 0);
});

test("retiring a drone schedules a randomized retry and a new leash", () => {
  // Given
  const { mind } = createChaseScenario();

  // When
  retireDrone(mind, 20);

  // Then
  assert.ok(mind.retryAtTick >= 26 && mind.retryAtTick <= 34);
  assert.ok(mind.leash >= 5 && mind.leash <= 12);
});

test("observations expose no leash or home information", () => {
  // Given
  const chase = createChaseScenario();
  runDrones(chase, 6);

  // When
  const exposed = JSON.stringify(chase.scenario.observe().world.drones[0]);

  // Then
  assert.doesNotMatch(exposed, /leash|home|retry/i);
});
