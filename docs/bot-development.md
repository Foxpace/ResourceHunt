# Bot development context

This guide supplies authoring and evaluation context for the [Copilot bot workflow](../.github/bot-workflow/README.md). Strategy code may inspect game source but must import game behavior through the [public SDK](../src/sdk.ts). Bot agents cannot patch the engine to make a strategy work.

## Workshop workflow

Participants follow [WORKSHOP.md](../WORKSHOP.md): Bot Intention, Bot Design, Bot Plan, Bot Build, and Bot Test & Review, one approved Markdown artifact each in `bots/<bot-id>/_workflow/`. Humans approve artifacts by editing them; agents cannot. See the [workflow README](../.github/bot-workflow/README.md) for what the hook enforces.

## Reading order

1. [Coding and test standards](../AGENTS.md). These apply to bots, helpers, and tests.
2. [README](../README.md). Setup, CLI use, starter strategy, current defaults, and game overview.
3. [SDK reference](sdk.md). Actions, observations, movement timing, route costs, inventory, trip planning, banking, competition, and world helpers.
4. [Maps](maps.md). Every biome, terrain costs, blocked tiles, generation constraints, and map settings.
5. [Competitive world](world.md). Capture and immunity, theft, sabotage/repair, traps, guard, drones, guardians/caches, forecasts, and threat helpers.
6. [Rewards](rewards.md). Resource value/weight, banked scoring, ranks, badges, and tournament rules.
7. [Workflow README](../.github/bot-workflow/README.md) and [templates](../.github/bot-workflow/templates/). Stage gates, approvals, runner operations, and evidence.

Read the current versions, not cached chat summaries. If a consequential fact is unclear, inspect the owning source below and cite the symbol. A discrepancy becomes a blocker or a proposed documentation correction for the maintainer. Do not invent a mechanic or silently patch shared docs from a bot agent.

## Sources of truth

| Question                                                  | Owning source                                                                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public imports and helper/type exports                    | [SDK](../src/sdk.ts)                                                                                                  |
| Action, observation, bot, and result contracts            | [Engine types](../src/engine/types.ts)                                                                                |
| Configuration normalization and bounds                    | [Config](../src/engine/config.ts)                                                                                     |
| Turn resolution, movement, banking, and match termination | [Game](../src/engine/game.ts)                                                                                         |
| Route costs and reachability                              | [Pathfinding](../src/engine/pathfinding.ts)                                                                           |
| Collection, capacity, trip, and rival timing helpers      | [Bot helpers](../src/engine/bot-helpers.ts)                                                                           |
| World action eligibility and threat estimates             | [World helpers](../src/engine/world/bot-helpers.ts)                                                                   |
| Current drone/world behavior                              | [World controller](../src/engine/world/world-controller.ts) and [scavengers](../src/engine/world/scavenger-drones.ts) |
| Bot files discovered and lineup selection                 | [Bot discovery](../src/runtime/bots.ts)                                                                               |
| Export/metadata validation and seeded construction        | [Bot worker](../src/runtime/bot-worker.ts)                                                                            |
| Timeout and worker destruction                            | [Worker controller](../src/runtime/worker-controller.ts)                                                              |
| Replica IDs and strategy grouping                         | [Lineup](../src/runtime/lineup.ts)                                                                                    |
| Benchmark rotation and seed grouping                      | [Benchmark](../src/runtime/benchmark.ts)                                                                              |
| CLI flag names and command restrictions                   | [CLI options](../src/cli/options.ts)                                                                                  |
| Replay/tournament inspection                              | [Inspect](../src/cli/inspect.ts)                                                                                      |
| Tournament scoring and rankings                           | [Tournament](../src/competition/tournament.ts) and [results](../src/competition/results.ts)                           |

These paths are read dependencies, not permission to import private modules into strategy code. Tests may import read-only engine APIs or existing fixtures when necessary to exercise real behavior.

## Loading a strategy

A discovered file must default-export a class with static metadata and an `act` method. The [worker](../src/runtime/bot-worker.ts) validates:

- `id` matches `^[a-z0-9][a-z0-9-]{0,47}$`, so it has 1 to 48 characters and begins with a lowercase letter or digit. IDs must be unique across discovered strategies.
- `name` has at least one non-whitespace character and is at most 60 characters.
- `description` is a string of at most 300 characters. An empty description is technically valid, but a bot should explain its policy.
- The optional constructor accepts one `BotContext` object with `random: () => number`.
- `act(observation)` returns an SDK `Action` or `Promise<Action>`. A synchronous decision is usually sufficient. Awaiting work does not escape the decision deadline.

Use `bots/<bot-id>.ts` for each strategy entry point, with imports from `../src/sdk.ts`. A helper or test under `bots/<bot-id>/` imports from `../../src/sdk.ts`. Include `.ts` extensions, following the repository. Do not use an invented package name for the SDK.

Discovery recursively visits `bots/`. It skips every file or directory whose name starts with `_` or `.`, and skips `.test.ts`, `.spec.ts`, and `.d.ts` files. An ordinary helper such as `bots/harbor/policy.ts` would be inspected as a bot. Name it `_policy.ts` instead. `_workflow` keeps artifacts and raw evidence out of discovery.

Discovery imports each candidate in an inspection worker and checks its metadata/prototype without constructing an instance. Top-level module code still runs during discovery. Keep imports and module initialization cheap and side-effect-free. Match start validates the ID again. If metadata changed after discovery, refresh the UI or start a new CLI invocation.

Strategy entry names match their metadata IDs, and the workflow folder uses the same ID. Start IDs with a letter for workflow compatibility, even though runtime IDs may begin with a digit.

## Match lifecycle and determinism

Every participant gets a new worker and bot instance for each match. Class fields persist within that match only. Do not expect module memory to persist across matches or communicate between replicas.

The runtime seeds randomness before importing the bot module, replaces worker `Math.random`, and supplies the same generator as `BotContext.random`. Match worker seeds include the configured match seed and participant ID. Prefer context randomness when explicitly managing a random policy. Do not use wall-clock time, unseeded external randomness, filesystem state, or network responses to decide actions.

Replicas receive distinct participant IDs such as `nearest-copy-1` while lineup descriptors retain the original `strategyId` for grouping. `Observation.self.id` is the participant identity, not necessarily the class's original metadata ID. Use it when matching ownership, defenses, opponents, and world targets. Do not assume `strategyId` exists on SDK `BotState`.

Identical code, lineup order, seed, and settings should reproduce behavior, provided the bot finishes within the deadline. OS scheduling can affect timeout failures, so determinism does not excuse a near-budget decision. Repeated checks must include errors and disabled participants, not just score.

An invalid action or thrown decision records an error and consumes a turn. A decision timeout terminates the worker and disables the bot for the rest of the match. Travel turns are automatic and do not invoke `act`. Never depend on a retry after timeout or count decision calls as game ticks.

Worker `console.log`, `console.info`, and `console.debug` go to stderr to preserve JSON stdout. Logs are not structured observations. Avoid logging every target calculation or large snapshots inside the decision loop.

Workers are not a security sandbox. They have local Node filesystem and network permissions. Bot policy must not use those powers, and evaluators must run only trusted bot code.

## Strategy correctness checklist

- Maximize the approved objective. Only deposited cargo adds score. Carried value, resource weight, resource-unit count, and banked score are different quantities.
- Use terrain-weighted routes, not Manhattan distance, for travel/deadline estimates. A valid move updates position immediately; extra terrain turns delay the next decision. Bank arrival can unload before the terrain delay finishes.
- Revalidate stock, capacity, bank ownership and availability, target eligibility, hazards, and deadlines against each fresh observation. Another bot can act earlier in the same tick and change them.
- A trip equal to `remainingTicks` can fit according to `planTrip`; an extra grab, capture, guard, strike, or detour can invalidate it. Rival arrival and readiness are different, and rotating initiative breaks ties.
- Built-in route helpers know terrain and current map costs. They are not a complete forecast of future hazards or rival intentions. Consult world helpers and forecasts when the design promises threat-aware movement.
- Repeated `planTrip` calls run repeated path searches. Shortlist with `distanceField`, reuse valid per-decision results, and measure worst map/lineup behavior. Persistent caches must invalidate when terrain or operational banks change.
- Handle absent resources, blocked/unreachable targets, full bags, all features off, interrupted captures, depot disabling, and late-game cargo. Every branch needs a legal fallback. Do not return an unsupported action.

The SDK and world guide contain the exact eligibility/cooldown rules. Read them before writing capture, steal, sabotage, repair, trap, guard, strike, or loot logic. Avoid hardcoding a rule where an exported helper already decides eligibility.

## Tests belong to the bot

Put strategy tests in `bots/<bot-id>/*.test.ts` or `.spec.ts`. Reuse [existing fixtures](../tests/helpers/) by read-only imports when suitable. A bot-owned scenario may use the real engine to assert observed decisions and outcomes; shipped bot code must still use only the SDK.

The root `tsconfig.json` includes bot TypeScript. Structure checking scans bot files recursively. The existing `yarn test` command runs only `tests/*.test.ts`, so it will not discover bot-owned tests. Run both suites explicitly.

For a human working outside the specialized agents:

```sh
node --import tsx --test bots/harbor/policy.test.ts
yarn test
yarn typecheck
yarn structure:check
yarn format:check
yarn bots
```

Bot agents run checks only through `node .github/bot-workflow/run.mjs <stage> <bot-id> <operation>`, which finds the bot's tests in `bots/<bot-id>/` and saves evidence. No new game test, helper modification, dependency, or lint exception is allowed just to fit a bot.

Each test has one observable behavior, at most 20 lines, and `// Given`, `// When`, `// Then` sections. Keep setup in bot-owned fixtures or existing reusable helpers. Tests should catch the wrong policy, not merely assert that a returned object has an action type. For a regression, show the expected failure before the fix and preserve the expectation through repair.

## Reproducible evaluation

Always select the candidate explicitly. The default lineup is chosen separately and may not contain a newly added bot. It supports at most 15 participants, with repeated IDs for replicas. Larger lineups also require larger minimum map dimensions.

Compare bots with comparable seeds, settings, opponents, lineup sizes, and rotations. The workflow runner's `bench` and `holdout` operations do this with a fixed lineup.

Human CLI examples:

```sh
yarn bots
yarn play --bots harbor,nearest,nearest,nearest --biome forest --seed dev-a --ticks 300
yarn --silent bench --bots harbor,nearest,nearest,nearest --matches 16 --biome riverlands --seed dev --json
yarn --silent play --bots harbor,nearest,nearest,nearest --seed replay-a --json --replay results/harbor.replay.json
yarn --silent tournament --bots harbor,nearest,nearest,nearest --biome forest --wins 3 --json
yarn inspect --input results/harbor.replay.json --tick 45 --bot harbor --map
```

`harbor` is an illustrative bot ID, not an included strategy. Bot agents use the workflow runner instead of these commands.

Benchmark match index `i` rotates the lineup by `i % participantCount`. A block of `participantCount` matches shares map seed `${config.seed}:${Math.floor(i / participantCount)}`. Use a match count divisible by participant count to balance starting bases. A 16-match four-bot benchmark represents four map seeds with four base rotations each, not 16 independent maps.

Keep code identity, opponents, lineup size/order, configurations, development and holdout seed prefixes, and complete rotations fixed when comparing versions. If two bot versions run in the same match, describe that opponent change rather than calling it an identical baseline. Report paired seed/base outcomes when available, variation, worst regressions, scores, ranks, wins, errors, and disabled states. Do not select only favorable seeds or claim confidence from too few independent maps.

Use `--timeout` for the decision budget, `--layout` for base placement, `--resources` for resource density, `--terrain` for roughness, and `--wins` for tournament target. Configuration object property names such as `decisionTimeoutMs` or `resourceDensity` are not CLI flags. See [CLI options](../src/cli/options.ts) for every current flag and valid command combination.

## Results and replay evidence

Single-match results include `config`, `botOrder`, `ticks`, `standings`, and `resourceUnitsLeft`. Standings include score, delivered units, carried value, rank, errors, disabled state, captures, owned outposts, stolen/lost units, and optional detailed statistics. Benchmarks include aggregated standings and individual match `results`; use individual results for seed/base comparison. Read [benchmark types](../src/runtime/benchmark.ts) for the exact aggregate fields rather than inventing metrics.

The [replay contract](../src/engine/types.ts) has `version`, `initial`, `frames`, and `result`. Frame events, bot states, resources, outposts, world state, and recorded statistics let you inspect a disputed choice at its actual tick. CLI `--round` starts at one; `--tick` starts at zero. Use participant IDs when inspecting replicas. Tournament inspection and single-match replay inspection have different records, so do not assume tournament round data has every replay field.

Tournament rounds rotate through biomes and end at the win target. Tied leaders can share a round win. Overall displayed standings and badge counts are not interchangeable with round-win progress. Consult [rewards](rewards.md) and [tournament implementation](../src/competition/tournament.ts) when defining a tournament objective.

CLI exit codes are `0` for success, `1` for input/runtime failures, and `2` for completed runs with bot or discovery errors. Nonzero results are not successful acceptance evidence. `--stats` controls displayed terminal columns; JSON retains detailed statistics. Badges do not add resource score.

Store exact arguments, code/config identity, exit codes, raw output, and replay tick references. Reviewer names and timestamps are not required. Existing benchmark tooling does not automatically certify latency percentiles, paired significance, or future robustness. State what was measured and what remains unverified.
