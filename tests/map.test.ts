import { test } from "node:test";
import { generateMap } from "../src/engine/map.ts";
import { createMapScenarios, MAP_DIMENSIONS, numberedSeeds } from "./helpers/map-fixtures.ts";
import {
  assertMapReachable,
  assertRiverCrossings,
  assertStartingTerrain,
  assertVariableRiverWidth,
} from "./helpers/map-assertions.ts";

const crossingScenarios = createMapScenarios({
  dimensions: MAP_DIMENSIONS,
  botCounts: [1, 2, 3, 4, 5, 6, 7, 8],
  seeds: numberedSeeds("", 6),
});
for (const scenario of crossingScenarios) {
  test(`bridges span the entire river: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assertRiverCrossings(generated.map);
    assertStartingTerrain(generated, "riverlands");
  });
}

for (const scenario of createMapScenarios({ botCounts: [8], seeds: numberedSeeds("river-", 12) })) {
  test(`wide river crossings connect both banks: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assertMapReachable(generated);
    assertVariableRiverWidth(generated.map);
  });
}
