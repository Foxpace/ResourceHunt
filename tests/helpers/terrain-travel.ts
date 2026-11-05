import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import {
  DEFAULT_CONFIG,
  type Biome,
  type Observation,
  type Terrain,
} from "../../src/engine/types.ts";
import { mapCells } from "../../src/engine/grid.ts";
import { samePosition, terrainCost } from "../../src/engine/pathfinding.ts";
import { advanceUntil, createBotController, createGame, moveToward } from "./game-fixtures.ts";

export async function createTerrainTravel(
  context: TestContext,
  options: { biome: Biome; terrain?: Terrain },
) {
  const traveler = { decisions: 0, target: undefined as { x: number; y: number } | undefined };
  const bot = createBotController("traveler", (state) => {
    traveler.decisions++;
    assert.equal(state.config.biome, options.biome);
    traveler.target ??= [...mapCells(state.map)].find((position) => {
      const terrain = state.map.tiles[position.y]![position.x];
      const movementCost = terrainCost(state.map, position);

      return options.terrain
        ? terrain === options.terrain
        : movementCost > 1 && Number.isFinite(movementCost);
    });
    assert.ok(traveler.target);

    return moveToward(state, traveler.target);
  });
  const game = createGame(context, {
    bots: [bot],
    config: { ...DEFAULT_CONFIG, biome: options.biome, ticks: 100 },
  });
  await advanceUntil(game, (snapshot) => hasArrived(snapshot.bots[0]!, traveler.target));

  return { game, traveler, remaining: game.snapshot().bots[0]!.travelRemaining };
}

function hasArrived(bot: Observation["self"], target?: { x: number; y: number }): boolean {
  return !!target && samePosition(bot.position, target);
}
