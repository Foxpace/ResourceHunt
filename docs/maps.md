# Maps

Use the UI's **Map** selector, or pass a biome ID to the CLI:

```sh
yarn play --biome moon --seed lunar-training
yarn bench --biome forest --matches 20 --seed maze-training
```

The biome, seed, dimensions, base layout, bot count, and generation settings determine the map. Benchmarks rotate bots through the same base slots before advancing the seed. Riverlands remains the default; replays saved before biome support use that theme.

## Templates

| ID            | Terrain and routes                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `riverlands`  | Open fields split by a continuous river, 2–5 tiles wide. Bridges span entire crossings. Forests and mountains add travel costs.                                                            |
| `valley`      | One winding valley branch per player, with bases on the floor. Cliffs separate branches; shared passes and the central basin connect them.                                                 |
| `desert`      | Every base starts at an oasis with a sand approach. Dune bands, mesas, and pools shape the routes beyond it.                                                                               |
| `moon`        | Each player starts in a crater basin with inward and outward rim exits. Overlapping basins connect the surrounding lunar plains.                                                           |
| `volcanic`    | A lava-filled caldera, an outer lava ring, and radial flows divide the map. Basalt causeways connect regions through the hazards.                                                          |
| `archipelago` | An island grid that grows with the player count. Every crossing has the same length, and every base is two moves from a bridge. Opposite crossings are mirrored where grid parity permits. |
| `tundra`      | Snowfields surround a frozen central lake. Ice is faster than snow; pockets of open water remain blocked.                                                                                  |
| `forest`      | A carved maze of narrow paths and wooded clearings, bounded by impassable thickets.                                                                                                        |

**Roughness** (`--terrain`, `config.terrainDensity`) adjusts wooded or rocky ground, dune coverage, crater size, ash coverage, or snowy mountain coverage, depending on the template. Zero roughness retains defining obstacles such as lava, cliff ridges, islands, and maze walls.

Generation clears fast starting ground around each base and supplies two opening crystals per player when resources are enabled. Extra random piles are excluded from the immediate starting area. Disconnected land is joined with short passages or crossings. All traversable tiles, resource piles, hotspots, and outposts can be reached from every base. Resources and strategic sites never occupy blocked terrain or bridges. Base clearings and connectivity repairs can alter the surrounding template, especially on small maps or with central bases.

Outposts and hotspots use travel times from the actual starting bases. Placement favors sites that at least two players can contest, keeps sites away from bases, and spreads them apart. Hotspot centers have extra clearance so their surrounding resources stay outside the immediate starting area.

The planner compares complete layouts, balancing each player's nearest site and their share of opportunities across all sites. Later hotspots count toward that balance too. Terrain features and the seed add variety, including sites outside the center when routes allow it. Crowded maps relax clearance and spacing only when needed to fit the requested sites. Resources remain finite, and terrain can still make some routes longer than others.

Lineups support **1–15 bots**. Up to eight players fit on 13 × 13 maps; larger lineups need more room for separate bases and supplies. Fifteen bots require at least 25 × 25. The UI grows dimensions automatically when needed; headless runs report the required minimum. Benchmark base rotation remains useful when comparing strategies across uneven global geography.

## Terrain costs

Costs count turns to enter a tile, including the current action. Position changes immediately; extra travel turns pass automatically before the bot acts again. Mountains and dunes can hold resources: reaching them simply takes longer.

| Turns   | Terrain IDs                                             |
| ------- | ------------------------------------------------------- |
| 1       | `grass`, `bridge`, `oasis`, `regolith`, `basalt`, `ice` |
| 2       | `forest`, `sand`, `crater`, `ash`, `snow`               |
| 3       | `mountain`, `dune`                                      |
| Blocked | `water`, `cliff`, `lava`, `thicket`                     |

Hover a tile in the UI to see its name and movement cost. Bots receive the full terrain grid and `state.config.biome` each decision. Use `getMoveOptions`, `terrainCost`, `findPath`, `distanceField`, and `planTrip` from the [SDK](sdk.md); they already account for every terrain type. Resource values, scoring, capture, and theft rules stay the same across biomes.

## Adding a template

Add its ID to `Biome` in `src/engine/types.ts` and its definition to `BIOMES` in `src/engine/biomes.ts`. Create a module in `src/engine/maps/templates/` that exports a `BiomeTemplate`, then register it in `BIOME_TEMPLATES` in `src/engine/maps/template-registry.ts`. Use the supplied random function so maps remain reproducible.

Base clearings, connectivity, resources, and competition sites are shared generation steps. Give the biome a one-turn `spawnTerrain` and a traversable `connectorTerrain`. Add any new terrain IDs and costs to `Terrain` and `TERRAIN_COST`, then colors and glyphs in `src/web/view/terrain.ts`. The catalog automatically supplies the UI's map options. Update CLI help and add the template's distinctive terrain to `tests/biomes.test.ts`.

Each biome module owns its terrain algorithm and any biome-specific placement rules.
`generateTerrain` receives a `BiomeTemplateContext`. Most biomes use `connectGeneratedLand`
from `map-connectivity.ts` for their `connectTerrain` step. Riverlands routes its river there;
Archipelago keeps the crossings already built during terrain generation.

Optional `selectBases` and `clearApproach` methods handle custom starting positions and
approaches. The shared coordinator selects bases, clears each base neighborhood, runs its
approach method, clears starting areas, and then connects terrain. Keep these rules in the
biome module so the coordinator does not need to branch on biome IDs.

Reusable grid and ellipse helpers live in `src/engine/maps/terrain-tools.ts`. River routing,
land connectivity, starting-area clearing, and competition placement remain shared tools
under `src/engine/maps/`.
