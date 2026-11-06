<p align="center">
  <img src="docs/assets/resource-hunt-icon.png" alt="Resource hunt icon" width="160" height="160" />
</p>

<h1 align="center">Resource Hunt</h1>

<p align="center">
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22.18%2B-339933?style=flat-square&amp;logo=node.js&amp;logoColor=white" alt="Node.js 22.18+" /></a>
  <a href="https://yarnpkg.com/"><img src="https://img.shields.io/badge/Yarn-1.22.22-2C8EBB?style=flat-square&amp;logo=yarn&amp;logoColor=white" alt="Yarn 1.22.22" /></a>
  <a href="https://tsx.is/"><img src="https://img.shields.io/badge/tsx-0F172A?style=flat-square" alt="tsx" /></a>
  <a href="https://esbuild.github.io/"><img src="https://img.shields.io/badge/esbuild-FFCF00?style=flat-square&amp;logo=esbuild&amp;logoColor=black" alt="esbuild" /></a>
</p>

A TypeScript simulator for building and comparing resource-hunting bots. Compete on seeded grid maps, carry resources home, and finish with the highest banked score.

Watch matches in the browser or run headless benchmarks. Both use the same game engine.

## Screenshots

| Riverlands                                                 | Volcanic                                                |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| ![Riverlands map preview](docs/assets/riverland-image.png) | ![Volcanic map preview](docs/assets/volcanic-image.png) |

## Run

Requires Node.js **22.18+** and Yarn **1.22.22**.

```sh
yarn install
yarn dev
```

Open [localhost:3000](http://127.0.0.1:3000). Use `PORT=3100 yarn dev` to change the port.

The setup panel walks through the match in order. Pick **Single match** or **Tournament**, choose a biome from the live map previews, add copies of each strategy (up to 15 participants), and adjust the rules if you like. **Create match** builds the arena and tucks the setup away; reopen it with **Setup** in the top bar. Press the play button on the board, or <kbd>Space</kbd>, to start. Use <kbd>→</kbd> to step one tick. The timeline lets you review completed ticks. Import and export replays to inspect runs later.

## Benchmark

```sh
# List available bots
yarn bots

# Run one match
yarn play --biome volcanic --seed training --ticks 300

# Compare strategies across maps and base positions
yarn bench --bots my-bot,nearest,nearest,nearest --matches 20 --seed training

# Run multiple independent copies of one strategy
yarn play --bots nearest,nearest,nearest --seed replicas

# Save JSON results and a replay
yarn --silent play --seed training --json \
  --output results/match.json --replay results/replay.json

# Pipe benchmark results into your own analysis
yarn --silent bench --matches 20 --json > results.json
```

In the browser, open **Bot statistics** beside the leaderboard and select a participant. Counters follow the current tick during a live match or while scrubbing an exported replay. Older replay files can still show scores, items banked, captures, thefts, losses, and errors from their recorded frames.

When a match finishes, a victory card appears on the board. **View results** opens the **Results** tab with the podium, final standings, and achievements. It shows up to three standout awards and five more drawn from the remaining earned awards. See [rewards and achievements](docs/rewards.md) for resource values, badge rules, and tournament wins.

Switch the setup to **Tournament**, set the round wins needed, and choose **Start tournament** to cycle through biomes without showing maps. The tournament starts on the selected biome and ends when a bot reaches the win target, which defaults to three. Tied leaders share a round win. Standings rank bots by total points banked and show badge totals. Choose any completed round and move the tick slider to see how its scores changed.

Open **Display options** on the Results or Tournament tab to choose how many badges are shown or select the statistics columns to display.

The CLI uses the same tournament rules and badge selection as the browser. Use `--stats` to choose terminal columns. JSON retains the full statistics.

```sh
yarn play --standout-badges 2 --random-badges 4 --stats tilesWalked,guardiansDefeated
yarn tournament --wins 3 --biome forest --output results/tournament.json
yarn inspect --input results/tournament.json
yarn inspect --input results/tournament.json --round 2 --tick 45
yarn inspect --input results/tournament.json --biome forest
yarn inspect --input results/replay.json --tick 45 --bot nearest --map
```

Round numbers start at one and ticks start at zero. Use a round number when a biome was played more than once. An intermediate tournament tick shows the scores recorded at that point. A finished round also shows the match statistics and badges. Match replays include per-tick activity and any detailed bot counters recorded by that replay version.

Benchmarks rotate bots through every base on each map. Use a match count divisible by the bot count for balanced comparisons. Results include scores, ranks, wins, and bot errors. Each row also has a `statistics` object. Benchmark rows sum those counters across matches, and `results` keeps each match and its base order for seed-by-seed comparisons.

Keep seeds, opponents, and settings fixed when comparing bot versions. Run `yarn play --help` for all options. Exit codes are `0` for success, `1` for run failures, and `2` for bot or discovery errors.

## Maps

Eight seeded templates change both the terrain and the routes bots must take:

| Map         | Layout                                                    |
| ----------- | --------------------------------------------------------- |
| Riverlands  | Winding river with wide, bank-to-bank bridges             |
| Valley      | One valley branch per player, cliff ridges, shared passes |
| Desert      | Slow dune bands, rocky mesas, scattered oases             |
| Moon        | Crater basins, broken rims, lunar plains                  |
| Volcanic    | Lava caldera, radial flows, basalt causeways              |
| Archipelago | Islands with equal crossings and bridge access            |
| Tundra      | Slow snowfields and fast frozen-lake routes               |
| Forest      | A maze of paths and clearings through dense thickets      |

Choose **Map** in the UI or use `--biome valley` in either CLI command. Riverlands is the default. The same biome, seed, dimensions, and settings reproduce the same map. Roughness adjusts each template's terrain mix; it preserves the template's defining features.

Starts have fast, theme-appropriate clearings and equal opening supplies. Terrain generation accounts for the player count: each player gets a valley branch, oasis, or crater start where appropriate. Archipelago crossings have equal lengths, and every base starts two moves from a bridge. Hotspots vary by seed and terrain, favoring sites contestable by multiple players and spreading opportunities between players.

The default 33 × 25 map supports 15 bots. Crowded lineups require larger minimum dimensions; the UI adjusts them automatically, and the CLI reports the minimum when needed.

Bots read `state.config.biome` and use the existing cost and pathfinding helpers on every map. See [map generation and terrain costs](docs/maps.md).

## Add a bot

Create `bots/my-bot.ts`. Default-exported classes are discovered automatically; refresh the UI or start a CLI run.

```ts
import { findPath, samePosition, type Action, type Bot, type Observation } from "../src/sdk.ts";

export default class MyBot implements Bot {
  static metadata = {
    id: "my-bot",
    name: "My bot",
    description: "Collects one resource, then returns home.",
  };

  act(state: Observation): Action {
    const { self, map, resources } = state;
    if (self.inventory.length) return { type: "home" };
    if (resources.some((pile) => samePosition(pile, self.position))) return { type: "grab" };

    const target = resources[0];
    const direction = target && findPath(map, self.position, target)?.steps[0];
    return direction ? { type: "move", direction } : { type: "skip" };
  }
}
```

Each `act(state)` receives a fresh snapshot of the full map, remaining resources, every bot, your inventory, settings, and remaining ticks. Turns resolve sequentially, so later bots see earlier decisions. Keep memory in class fields.

Return `move` with direction `N`, `W`, `E`, or `S`, or return `grab`, `skip`, `home`, `capture`, or `steal` with a `targetId`. `home` takes one step toward the nearest owned bank. Arrival at your base or an owned outpost banks cargo automatically.

The [SDK reference](docs/sdk.md) documents every helper, action, state field, and exported type, with examples for movement costs, pathfinding, and inventory. The included [nearest](bots/nearest.ts) bot is a deliberately simple baseline to beat. `Math.random` is seeded per bot. Helpers beginning with `_` and test files are excluded from discovery; bot IDs must be unique lowercase letters, digits, or hyphens.

Workers enforce decision timeouts. Bots run with local Node.js filesystem and network permissions.

For bot discovery details, lifecycle, tests, and evaluation, read [bot development context](docs/bot-development.md). For the AI-native workshop, start with [WORKSHOP.md](WORKSHOP.md): five Copilot agents take a team from intention to design, plan, build, and review, with one human-approved Markdown artifact per stage. Bot agents may inspect the game but change only their own bot's code and artifacts.

## Rules

Defaults: **33 × 25 grid, 300 ticks, four bots, capacity 8, 100 ms per decision**.

- Each tick gives every bot a turn; starting order rotates.
- Terrain costs 1–3 turns. Water, cliffs, lava, and thickets block movement.
- Every map keeps bases, resources, and outposts reachable.
- Grab collects one unit if it fits. Resources do not respawn.
- Finite crystal/relic hotspots concentrate valuable supplies at terrain-aware locations.
- Capture outposts with three consecutive uncontested `capture` turns. Owners can bank there; rivals can reclaim them after a three-round protection window. Each capture renews protection against recapture and sabotage. Leaving, taking another action, or an active rival entering interrupts capture.
- `steal` transfers one highest-value fitting item from a bot on your tile or one orthogonal tile away. Either bot standing on a base tile prevents theft. Successful theft has a five-tick cooldown; both participants are protected through the next tick.
- Bots share tiles without movement blocking.
- Only banked resources score. Ties share a rank; unbanked inventory earns nothing.
- Invalid decisions cost a turn. A timed-out bot is disabled for the match.

Hotspots, outposts, theft, sabotage, cargo traps, scavenger drones, guardian caches, and forecast natural events are enabled by default. The only included bot is Scout ([nearest](bots/nearest.ts)): it walks to the closest resource that fits, grabs it, and banks when full or late. It ignores theft, outposts, and threats, which leaves those to your bot. Read the [competitive world rules](docs/world.md) for counterplay and SDK examples. Adjust these settings under Advanced in the UI or through the CLI:

```sh
yarn play --hotspots 3 --outposts 2 --capture-turns 3 --capture-immunity 3 --steal-cooldown 5
yarn play --hotspots 0 --outposts 0 --stealing false
```

JSON standings and benchmarks include captures, outposts owned, stolen units, and lost units. Statistics count completed grabs, deposits, theft value, sabotage attempts and completions, depot downtime, repairs, trap placements and hits, guardian fights and loot, and drone stuns. Trap triggers credit the trap owner and hits count against the victim. Stolen value measures cargo acquired before banking. Existing bots remain valid; old replays import with competition disabled.

| Resource | Value | Weight |
| -------- | ----: | -----: |
| Ore      |     2 |      1 |
| Crystal  |     7 |      2 |
| Relic    |    14 |      3 |

## Development

```sh
yarn run check  # Formatting, TypeScript, and tests
yarn format     # Format the codebase
yarn start      # Run without watching
yarn build      # Export browser assets to dist/
```

`yarn dev` watches source changes; reload the browser after edits. Matches require the local server, including when using the exported browser assets.

Game rules live in [`src/engine/`](src/engine/), bot execution and benchmarks in [`src/runtime/`](src/runtime/), and the UI in [`src/web/`](src/web/). Use [`src/index.ts`](src/index.ts) to run the engine from your own scripts.

Runtime dependencies are limited to `tsx` and `esbuild`. Tests use Node's built-in runner. Use `yarn install --frozen-lockfile` in CI.

## License

MIT — see [LICENSE](LICENSE).

## Code organization

```text
src/
├── engine/             Game rules, state, configuration, navigation, and replay validation
│   ├── world/          Sabotage, traps, neutral enemies, hazards, and replay validation
│   └── maps/           Generation coordination and shared geometry, rivers, and site tools
│       └── templates/  One module per biome, including its special placement rules
├── runtime/            Bot discovery, worker isolation, matches, and benchmarks
├── http/               HTTP routes and browser asset bundling
├── cli/                Command arguments and configuration
└── web/
    ├── app.ts          Browser startup and shutdown
    ├── data/           HTTP game client
    ├── model/          Application state, playback, and map descriptions
    └── view/           DOM bindings, HTML panels, and canvas drawing
bots/                   Example bot strategies
scripts/                Code structure checks
tests/                  Behavior tests and shared local game client
```

The browser keeps application behavior in `web/model` and rendering in `web/view`.
Views forward user actions and display the resulting state. HTTP access lives in
`web/data`, and game rules live in `engine`.

Playback responsibilities live in three modules under `web/model/`:

- `playback.ts` coordinates timing, playback controls, and state notifications.
- `playback-session.ts` owns the empty, live, or recorded source, in-flight requests, and session cleanup.
- `playback-timeline.ts` owns recorded frames, cursor navigation, and recent events.

The latest source-selection request wins. Replacement waits for an active tick, and late
sessions from superseded creation requests are released. Failed replacement keeps the
previous source usable. Disposal invalidates pending selections immediately, suppresses
late publications, and releases the active session after its tick finishes. A session
created after disposal is released when its response arrives.

The application tracks import and generation requests before reading replay files, so
an older file read cannot override a newer source request. Generation controls derive their
busy state from the current playback selection.

See [AGENTS.md](AGENTS.md) for coding and test standards.
