import assert from "node:assert/strict";
import { test } from "node:test";
import { balanceOpeningResources } from "../src/engine/maps/opening-resources.ts";
import { findPath } from "../src/engine/pathfinding.ts";
import type { ResourcePile } from "../src/engine/types.ts";
import { createOpenSiteScenario } from "./helpers/site-fixtures.ts";

function createOpeningScenario() {
  const { setup } = createOpenSiteScenario(0);
  const bases = [
    { x: 27, y: 12 },
    { x: 5, y: 12 },
  ];
  return { setup, layout: { bases, protectedCells: bases, hotspots: [], outposts: [] } };
}

test("a base with no nearby stock gains a pile within a short round trip", () => {
  // Given
  const { setup, layout } = createOpeningScenario();
  const piles: ResourcePile[] = [
    { x: 23, y: 12, kind: "crystal", amount: 2 },
    { x: 23, y: 13, kind: "crystal", amount: 2 },
  ];

  // When
  balanceOpeningResources(setup, layout, piles);

  // Then
  const routes = piles.map((pile) => findPath(setup.map, layout.bases[1]!, pile));
  assert.ok(routes.some((route) => route?.cost === 4));
});

test("an equally accessible pile stays available to both bases", () => {
  // Given
  const { setup, layout } = createOpeningScenario();
  const shared: ResourcePile = { x: 16, y: 12, kind: "ore", amount: 1 };
  const piles = [shared, { x: 23, y: 12, kind: "relic", amount: 2 } satisfies ResourcePile];

  // When
  balanceOpeningResources(setup, layout, piles);

  // Then
  assert.deepEqual(shared, { x: 16, y: 12, kind: "ore", amount: 1 });
});
