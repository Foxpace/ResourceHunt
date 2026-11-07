import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatchStatistics } from "../src/engine/match-statistics.ts";
import { manhattanDistance } from "../src/engine/grid.ts";
import {
  canSabotage,
  canRepair,
  canDeployTrap,
  canStrike,
  canLootCache,
  getBankingSites,
  getDefensiveAction,
  getGuardianFightAction,
  protectDroneCrossing,
  getCompetitiveAction,
  getHazardMap,
} from "../src/sdk.ts";
import {
  WorldScenario,
  armTrap,
  createCache,
  createTrap,
  createDrone,
  createHazard,
  disableDepot,
} from "./helpers/world-fixtures.ts";

test("one sabotage turn disables banking for six ticks", () => {
  // Given
  const scenario = new WorldScenario();

  // When
  disableDepot(scenario);

  // Then
  assert.equal(scenario.depot.disabledUntilTick, 16);
  assert.equal(scenario.depot.sabotageProtectedUntilTick, 22);
  assert.equal(getBankingSites(scenario.observe("defender")).length, 1);
});

test("a repaired depot stays protected against another sabotage until cooldown expires", () => {
  // Given
  const scenario = new WorldScenario();
  disableDepot(scenario);
  scenario.act({ type: "repair", targetId: "outpost-1" }, "defender");

  // When
  scenario.advanceTo(21);
  const protectedBeforeExpiry = !canSabotage(scenario.observe(), "outpost-1");
  scenario.advanceTo(22);

  // Then
  assert.equal(protectedBeforeExpiry, true);
  assert.equal(canSabotage(scenario.observe(), "outpost-1"), true);
  disableDepot(scenario);
  assert.equal(scenario.depot.disabledUntilTick, 28);
});

test("a guarding owner blocks nearby depot sabotage", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.act({ type: "guard" }, "defender");

  // When
  scenario.act({ type: "sabotage", targetId: "outpost-1" });

  // Then
  assert.equal(canSabotage(scenario.observe(), "outpost-1"), false);
});

for (const restriction of ["disabled", "owned", "neutral", "distant"] as const) {
  test(`sabotage rejects a ${restriction} depot target`, () => {
    // Given
    const scenario = new WorldScenario({ sabotage: restriction !== "disabled" });
    if (restriction === "owned") scenario.depot.ownerId = "attacker";
    if (restriction === "neutral") scenario.depot.ownerId = null;
    if (restriction === "distant") scenario.attacker.position = { x: 1, y: 1 };

    // When
    scenario.act({ type: "sabotage", targetId: "outpost-1" });

    // Then
    assert.equal(scenario.depot.disabledUntilTick, undefined);
    assert.equal(canSabotage(scenario.observe(), "outpost-1"), false);
  });
}

test("an owner repairs disabled banking in one turn", () => {
  // Given
  const scenario = new WorldScenario();
  disableDepot(scenario);

  // When
  const repairAvailable = canRepair(scenario.observe("defender"), "outpost-1");
  scenario.act({ type: "repair", targetId: "outpost-1" }, "defender");

  // Then
  assert.equal(repairAvailable, true);
  assert.equal(scenario.depot.disabledUntilTick, 0);
  assert.equal(getBankingSites(scenario.observe("defender")).length, 2);
});

test("sabotage expires without permanently removing banking access", () => {
  // Given
  const scenario = new WorldScenario();
  disableDepot(scenario);

  // When
  scenario.advanceTo(16);

  // Then
  assert.equal(getBankingSites(scenario.observe("defender")).length, 2);
});

test("deploying a cargo trap spends one ore and announces its arming tick", () => {
  // Given
  const scenario = new WorldScenario();

  // When
  scenario.act({ type: "deployTrap" });

  // Then
  assert.deepEqual(scenario.attacker.inventory, ["crystal"]);
  assert.partialDeepStrictEqual(scenario.state.traps[0], {
    ownerId: "attacker",
    armedAt: 11,
    expiresAt: 40,
  });
  assert.equal(canDeployTrap(scenario.observe()), false);
});

test("an armed trap spills one rival item and delays movement", () => {
  // Given
  const scenario = new WorldScenario();
  armTrap(scenario);

  // When
  scenario.moveDefender({ x: 5, y: 6 });

  // Then
  assert.deepEqual(scenario.defender.inventory, ["relic"]);
  assert.equal(scenario.defender.travelRemaining, 1);
  assert.equal(scenario.defender.lost, 1);
  assert.equal(scenario.context.resources[0]!.kind, "crystal");
  assert.equal(scenario.state.traps.length, 0);
});

test("an unarmed trap cannot ambush a rival on the deployment tick", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.act({ type: "deployTrap" });

  // When
  scenario.moveDefender({ x: 5, y: 6 });

  // Then
  assert.equal(scenario.defender.inventory.length, 2);
  assert.equal(scenario.state.traps.length, 1);
});

test("a trap arms under a rival carrying cargo and credits its owner once", () => {
  // Given
  const scenario = new WorldScenario();
  const owner = createMatchStatistics();
  const victim = createMatchStatistics();
  scenario.context.statistics = new Map([
    ["attacker", owner],
    ["defender", victim],
  ]);
  scenario.act({ type: "deployTrap" });
  scenario.moveDefender(scenario.attacker.position);
  // When
  scenario.advanceTo(11);
  scenario.advanceTo(12);
  // Then
  assert.deepEqual(scenario.defender.inventory, ["relic"]);
  assert.equal(owner.trapsPlaced, 1);
  assert.equal(owner.trapsTriggered, 1);
  assert.equal(victim.trapsHit, 1);
});

test("guard protects cargo while crossing an armed trap", () => {
  // Given
  const scenario = new WorldScenario();
  armTrap(scenario);
  scenario.act({ type: "guard" }, "defender");

  // When
  scenario.moveDefender({ x: 5, y: 6 });

  // Then
  assert.equal(scenario.defender.inventory.length, 2);
  assert.equal(scenario.defender.travelRemaining, 0);
});

test("a bot can clear an adjacent trap before crossing", () => {
  // Given
  const scenario = new WorldScenario();
  armTrap(scenario);
  scenario.defender.position = { x: 5, y: 5 };

  // When
  scenario.act({ type: "clearTrap", targetId: scenario.state.traps[0]!.id }, "defender");
  scenario.moveDefender({ x: 5, y: 6 });

  // Then
  assert.equal(scenario.state.traps.length, 0);
  assert.equal(scenario.defender.inventory.length, 2);
});

test("cargo traps expire after thirty ticks", () => {
  // Given
  const scenario = new WorldScenario();
  armTrap(scenario);

  // When
  scenario.advanceTo(40);

  // Then
  assert.deepEqual(scenario.state.traps, []);
});

for (const restriction of [
  "no ore",
  "base safety",
  "disabled rules",
  "two active traps",
] as const) {
  test(`trap deployment respects ${restriction}`, () => {
    // Given
    const scenario = new WorldScenario({ cargoTraps: restriction !== "disabled rules" });
    if (restriction === "no ore") scenario.attacker.inventory = ["crystal"];
    if (restriction === "base safety") scenario.attacker.position = scenario.attacker.base;
    if (restriction === "two active traps")
      scenario.state.traps = [createTrap(), createTrap({ id: "trap-2", y: 6 })];

    // When
    const allowed = canDeployTrap(scenario.observe());

    // Then
    assert.equal(allowed, false);
  });
}

test("a drone pursues an exposed bot and stuns it on arrival", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.attacker.position = scenario.attacker.base;
  scenario.defender.inventory = [];
  scenario.state.drones = [createDrone()];

  // When
  scenario.advanceTo(10);

  // Then
  assert.deepEqual(scenario.state.drones[0]!.position, scenario.defender.position);
  assert.equal(scenario.defender.travelRemaining, 1);
  assert.deepEqual(scenario.defender.inventory, []);
});

test("SDK defense guards when a drone shares the bot's tile", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.drones = [createDrone({ position: scenario.defender.position })];

  // When
  const defense = getDefensiveAction(scenario.observe("defender"));

  // Then
  assert.equal(defense?.type, "guard");
});

test("SDK defense steps out of reach of an adjacent drone", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.drones = [createDrone({ position: { x: 6, y: 6 } })];

  // When
  const defense = getDefensiveAction(scenario.observe("defender"));

  // Then
  assert.equal(defense?.type, "move");
});

test("SDK defense guards before walking onto a drone about to attack", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.drones = [createDrone({ position: { x: 6, y: 6 } })];

  // When
  const action = protectDroneCrossing(scenario.observe(), { type: "move", direction: "E" });

  // Then
  assert.deepEqual(action, { type: "guard" });
});

test("guard protects a bot from a drone attack", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.attacker.position = scenario.attacker.base;
  scenario.state.drones = [createDrone({ position: scenario.defender.position })];
  scenario.act({ type: "guard" }, "defender");

  // When
  scenario.advanceTo(11);

  // Then
  assert.equal(scenario.defender.travelRemaining, 0);
  assert.deepEqual(scenario.defender.inventory, ["relic", "crystal"]);
});

test("a drone leaves loose resources in place when it patrols over them", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.attacker.position = scenario.attacker.base;
  scenario.defender.position = scenario.defender.base;
  scenario.context.resources = [{ x: 7, y: 6, kind: "relic", amount: 2 }];
  scenario.state.drones = [createDrone()];

  // When
  scenario.advanceTo(10);

  // Then
  assert.deepEqual(scenario.state.drones[0]!.position, { x: 7, y: 6 });
  assert.equal(scenario.context.resources[0]!.amount, 2);
});

test("two strikes disable a drone and release its entire stash", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.drones = [createDrone({ inventory: ["relic", "crystal"], nextMoveTick: 99 })];

  // When
  scenario.act({ type: "strike", targetId: "drone-1" });
  scenario.advanceTo(11);
  scenario.act({ type: "strike", targetId: "drone-1" });

  // Then
  assert.equal(scenario.state.drones[0]!.health, 0);
  assert.deepEqual(scenario.state.drones[0]!.inventory, []);
  assert.equal(
    scenario.context.resources.reduce((sum, pile) => sum + pile.amount, 0),
    2,
  );
});

test("a living guardian prevents cache looting", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache()];
  scenario.attacker.position = { x: 6, y: 6 };

  // When
  scenario.act({ type: "lootCache", targetId: "cache-1" });

  // Then
  assert.equal(scenario.state.caches[0]!.inventory.length, 4);
  assert.equal(canLootCache(scenario.observe(), "cache-1"), false);
});

test("a solo bot can defeat a ready guardian by guarding between strikes", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.defender.position = scenario.defender.base;
  scenario.state.caches = [createCache({ nextAttackTick: 11 })];

  // When
  const actions = [];
  for (let tick = 10; tick < 15; tick++) {
    scenario.advanceTo(tick);
    const action = getGuardianFightAction(scenario.observe(), "cache-1")!;
    actions.push(action.type);
    scenario.act(action);
  }

  // Then
  assert.deepEqual(actions, ["guard", "strike", "guard", "strike", "strike"]);
  assert.equal(scenario.state.caches[0]!.guardianHealth, 0);
});

test("a guardian repels an unguarded bot before its next strike", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.defender.position = scenario.defender.base;
  scenario.state.caches = [createCache({ nextAttackTick: 0 })];

  // When
  scenario.act({ type: "strike", targetId: "cache-1" });
  scenario.advanceTo(11);

  // Then
  assert.equal(scenario.state.caches[0]!.guardianHealth, 2);
  assert.equal(scenario.attacker.travelRemaining, 1);
  assert.deepEqual(scenario.attacker.inventory, ["ore"]);
});

test("cache looting transfers one fitting resource per turn", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache({ guardianHealth: 0 })];
  scenario.attacker.position = { x: 6, y: 6 };

  // When
  scenario.act({ type: "lootCache", targetId: "cache-1" });

  // Then
  assert.deepEqual(scenario.attacker.inventory, ["ore", "crystal", "relic"]);
  assert.equal(scenario.state.caches[0]!.inventory.length, 3);
});

test("cache looting respects bag capacity", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache({ guardianHealth: 0 })];
  scenario.attacker.position = { x: 6, y: 6 };
  scenario.attacker.inventory = ["relic", "relic", "ore"];

  // When
  scenario.act({ type: "lootCache", targetId: "cache-1" });

  // Then
  assert.equal(scenario.state.caches[0]!.inventory.length, 4);
  assert.equal(canLootCache(scenario.observe(), "cache-1"), false);
});

test("guardians repel adjacent exposed bots and spill one cargo unit", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache({ nextAttackTick: 0 })];

  // When
  scenario.advanceTo(10);

  // Then
  assert.equal(scenario.attacker.inventory.length, 1);
  assert.equal(scenario.attacker.travelRemaining, 1);
  assert.equal(scenario.state.caches[0]!.nextAttackTick, 13);
  assert.equal(manhattanDistance(scenario.attacker.position, { x: 6, y: 6 }), 4);
});

test("guard protects against a guardian on the next world turn", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache({ nextAttackTick: 0 })];
  scenario.act({ type: "guard" });
  scenario.defender.position = scenario.defender.base;

  // When
  scenario.advanceTo(11);

  // Then
  assert.equal(scenario.attacker.inventory.length, 2);
  assert.equal(scenario.attacker.travelRemaining, 0);
});

test("lava is forecast before becoming temporary blocked terrain", () => {
  // Given
  const scenario = new WorldScenario({ naturalEvents: true });
  scenario.state.hazards = [createHazard()];

  // When
  const forecastMap = getHazardMap(scenario.context.map, scenario.state, 10);
  const activeMap = getHazardMap(scenario.context.map, scenario.state, 11);

  // Then
  assert.equal(forecastMap.tiles[6]![5], "grass");
  assert.equal(activeMap.tiles[6]![5], "lava");
  assert.equal(scenario.context.map.tiles[6]![5], "grass");
});

test("natural impacts spill cargo and delay exposed bots", () => {
  // Given
  const scenario = new WorldScenario({ naturalEvents: true });
  scenario.state.hazards = [createHazard()];

  // When
  scenario.advanceTo(11);

  // Then
  assert.equal(scenario.attacker.inventory.length, 1);
  assert.equal(scenario.attacker.travelRemaining, 1);
  assert.equal(scenario.context.resources.length, 1);
});

test("guard prevents cargo loss and delay during an impact", () => {
  // Given
  const scenario = new WorldScenario({ naturalEvents: true });
  scenario.state.hazards = [createHazard()];
  scenario.act({ type: "guard" });

  // When
  scenario.advanceTo(11);

  // Then
  assert.equal(scenario.attacker.inventory.length, 2);
  assert.equal(scenario.attacker.travelRemaining, 0);
});

test("expired hazards restore the original traversable terrain", () => {
  // Given
  const scenario = new WorldScenario({ naturalEvents: true });
  scenario.state.hazards = [createHazard()];

  // When
  scenario.advanceTo(18);
  const restored = getHazardMap(scenario.context.map, scenario.state, 18);

  // Then
  assert.equal(restored.tiles[6]![5], "grass");
  assert.deepEqual(scenario.state.hazards, []);
});

test("SDK tactics evacuate forecast impacts and pursue nearby sabotage", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.hazards = [createHazard()];

  // When
  const defense = getDefensiveAction(scenario.observe());
  const competition = getCompetitiveAction(scenario.observe());

  // Then
  assert.equal(defense?.type, "move");
  assert.deepEqual(competition, { type: "sabotage", targetId: "outpost-1" });
});

test("sabotage cooldown applies per depot", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.context.outposts.push({ ...scenario.depot, id: "outpost-2", x: 5, y: 5 });
  disableDepot(scenario);

  // When
  scenario.advanceTo(11);
  scenario.act({ type: "sabotage", targetId: "outpost-2" });

  // Then
  assert.equal(scenario.depot.sabotageProtectedUntilTick, 22);
  assert.equal(scenario.context.outposts[1]!.sabotageProtectedUntilTick, 23);
});

test("guardians leave bots in protected starting areas alone", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.attacker.position = { x: 2, y: 1 };
  scenario.defender.position = scenario.defender.base;
  scenario.state.caches = [createCache({ position: { x: 3, y: 1 }, nextAttackTick: 0 })];

  // When
  scenario.advanceTo(10);

  // Then
  assert.equal(scenario.attacker.inventory.length, 2);
  assert.equal(scenario.attacker.travelRemaining, 0);
});

test("an idle drone patrols when there are no exposed bots", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.attacker.position = scenario.attacker.base;
  scenario.defender.position = scenario.defender.base;
  scenario.state.drones = [createDrone()];

  // When
  scenario.advanceTo(10);

  // Then
  assert.equal(manhattanDistance(scenario.state.drones[0]!.position, { x: 6, y: 6 }), 1);
});

test("a guardian pursues an intruder while its cache stays in place", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache({ nextAttackTick: 0 })];
  scenario.attacker.position = { x: 3, y: 6 };
  scenario.defender.position = scenario.defender.base;

  // When
  scenario.advanceTo(10);

  // Then
  assert.deepEqual(scenario.state.caches[0]!.guardianPosition, { x: 5, y: 6 });
  assert.deepEqual(scenario.state.caches[0]!.position, { x: 6, y: 6 });
});

test("strikes target the moving guardian rather than its cache", () => {
  // Given
  const scenario = new WorldScenario();
  const cache = createCache({ guardianPosition: { x: 4, y: 6 } });
  scenario.state.caches = [cache];
  scenario.attacker.position = { x: 3, y: 6 };

  // When
  const inRange = canStrike(scenario.observe(), cache.id);
  scenario.act({ type: "strike", targetId: cache.id });

  // Then
  assert.equal(inRange, true);
  assert.equal(cache.guardianHealth, 2);
});

test("guardian pushback cannot cross an impassable tile", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.caches = [createCache({ nextAttackTick: 0 })];
  scenario.context.map.tiles[6]![4] = "water";

  // When
  scenario.advanceTo(10);

  // Then
  const distanceFromCache = manhattanDistance(scenario.attacker.position, { x: 6, y: 6 });
  assert.equal(distanceFromCache, 4);
  assert.notDeepEqual(scenario.attacker.position, { x: 2, y: 6 });
});

test("a guardian pushes a bot at the edge of its territory three tiles away", () => {
  // Given
  const scenario = new WorldScenario();
  const cache = createCache({ guardianPosition: { x: 8, y: 6 }, nextAttackTick: 0 });
  scenario.state.caches = [cache];
  scenario.defender.position = { x: 9, y: 6 };
  const startingPosition = scenario.defender.position;

  // When
  scenario.advanceTo(10);

  // Then
  assert.equal(manhattanDistance(scenario.defender.position, startingPosition), 3);
  assert.equal(manhattanDistance(scenario.defender.position, cache.position), 6);
});

test("a drone attack stuns the bot and steals one carried resource", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.state.drones = [createDrone({ position: scenario.defender.position })];

  // When
  scenario.advanceTo(10);

  // Then
  assert.equal(scenario.defender.travelRemaining, 1);
  assert.equal(scenario.defender.lost, 1);
  assert.deepEqual(scenario.defender.inventory, ["relic"]);
  assert.deepEqual(scenario.state.drones[0]!.inventory, ["crystal"]);
});

test("stolen cargo disappears eight ticks later even while the drone is waiting to move", () => {
  // Given
  const scenario = new WorldScenario();
  const drone = createDrone({ position: scenario.defender.position });
  scenario.state.drones = [drone];
  scenario.advanceTo(10);
  drone.nextMoveTick = 19;

  // When
  scenario.advanceTo(17);
  const cargoBeforeExpiry = [...drone.inventory];
  scenario.advanceTo(18);

  // Then
  assert.deepEqual(cargoBeforeExpiry, ["crystal"]);
  assert.deepEqual(drone.inventory, []);
  assert.deepEqual(scenario.context.resources, []);
});

test("a drone with room for cargo favors a loaded bot over a closer empty bot", () => {
  // Given
  const scenario = new WorldScenario();
  const drone = createDrone();
  scenario.state.drones = [drone];
  scenario.attacker.inventory = [];
  scenario.defender.position = { x: 8, y: 6 };

  // When
  scenario.advanceTo(10);

  // Then
  assert.deepEqual(drone.position, { x: 7, y: 6 });
});
