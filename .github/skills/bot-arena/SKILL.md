---
name: bot-arena
description: "Benchmark, compare, replay, and hand in Resource Hunt bots: runner operations, lineups with practice bots, fair comparisons, practice tournaments, reading score tables, packing the hand-in zip, and evidence. Use whenever a workshop agent runs bench, holdout, play, tournament, pack, or raw yarn bench/play/tournament commands."
---

# Bot arena

Prove things with the game itself. The game CLI is the test suite: a bot that runs every biome with zero errors and banks more than its rivals works.

## The runner (saves evidence)

```sh
node .github/bot-workflow/run.mjs <stage> <bot-id> <operation> [biome] [--vs id,id,...]
```

| Operation    | What it does                                                                     | Stages              | Time  |
| ------------ | -------------------------------------------------------------------------------- | ------------------- | ----- |
| `status`     | Which artifacts are missing, draft, or approved                                  | all                 | 1 s   |
| `baseline`   | Four copies of `nearest` on every biome. Already measured, see below             | all                 | ~40 s |
| `bench`      | The team bot vs opponents on the 8 practice biomes                               | plan, build         | ~45 s |
| `play`       | One match saved as a replay in `results/`                                        | plan, build, review | ~3 s  |
| `check`      | Discovery of the team's bots, types, structure rules, formatting                 | build, review       | ~15 s |
| `format`     | Formats `bots/<id>.ts`, `bots/<id>-*.ts`, and `bots/<id>/`                       | build, review       | 2 s   |
| `holdout`    | `bench` on unseen maps: the final proof, once at the end of Build                | build               | ~80 s |
| `tournament` | Three tournaments (seeds `handin-1..3`, first to 3 round wins) with a summary    | review              | ~20 s |
| `pack`       | Needs an approved REVIEW.md. Deletes practice bots, runs `check`, writes the zip | review              | ~15 s |

- `--vs` replaces the default opponents (`nearest,nearest,nearest`). The team bot is always first. Up to 14 opponents; repeat an ID for copies. Time grows with lineup size.
- A biome argument focuses one map type and doubles its matches. Biomes: riverlands, valley, desert, moon, volcanic, archipelago, tundra, forest.
- Evidence lands in `bots/<id>/_workflow/evidence/<stage>-<operation>[-biome][-vs-...].txt`. Cite these paths in artifacts.

## Lineups that answer questions

| Question                          | Lineup                                              |
| --------------------------------- | --------------------------------------------------- |
| Does it beat the baseline?        | default (`nearest` ×3): comparable with `baseline`  |
| Which setting of our bot is best? | `--vs <id>-<setting>,nearest,nearest`               |
| Does it survive rival tactics?    | `--vs <id>-<rival>,<id>-<rival>,nearest`            |
| Tournament dress rehearsal        | `tournament`: every practice bot plus two `nearest` |

Bots in the same match change each other's results (theft, races, captures). Compare ranks and wins within one table, and keep the default lineup as the anchor everyone shares.

## The simple bot's scores (measured)

Four copies of `nearest` with the runner's `baseline` seeds average **about 97 per match**: tundra 123, riverlands 116, volcanic 106, desert 97, archipelago 89, valley 84, moon 84, forest 75. Do not rerun it. Use these numbers to turn relative targets into checks: "clearly better" is about 110, "a lot better" 130 or more.

## Free experiments (no evidence saved)

The terminal is open. For quick questions, run the game directly:

```sh
yarn bots
yarn --silent bench --bots comet,comet-greedy,nearest,nearest --matches 8 --biome forest --seed dev-x --json
yarn --silent play --bots comet,nearest,nearest,nearest --biome moon --seed dev-y --replay results/comet-moon.replay.json
yarn --silent tournament --bots comet,comet-thief,comet-greedy,nearest --wins 3
yarn inspect --input results/comet-moon.replay.json --tick 120 --bot comet --map
```

- Use a match count that is a multiple of the lineup size, so every bot starts from every base.
- Compare versions on the same seed, biome, and lineup.
- Never use a seed starting with `holdout` for tuning. Run the runner's `holdout` once, at the end of Build, as the final proof.
- Results that matter for an artifact must come from the runner, so they have evidence files.

## Reading a table

- `errors` must be 0. Any error or timeout is a defect, not noise.
- `mean` is the average banked score across biomes; also name the weakest biome.
- Four matches per biome is a quick signal. When two versions are close, rerun on the deciding biome (double matches) before choosing.
- Fixed seeds give the same result every time. Do not rerun hoping for a better number.

## Telling the team

Translate every table into one or two plain lines: "Banks about 120 per match, a quarter more than the simple bot. Weakest on forest. No crashes." Never paste tables or operation names into chat; they go into the artifact with their evidence path.

## Hand-in

- `tournament` puts the team bot first, then every `bots/<id>-*.ts` practice bot, then two `nearest`; `--vs` replaces the opponents. It reports place, round wins, score, and errors per tournament, then "won X of 3, average place Y of N".
- `pack` refuses to run until REVIEW.md is approved. It then deletes `bots/<id>-*.ts`, reruns `check`, and zips `bots/<id>.ts` and `bots/<id>/` into `results/<id>-handin.zip`. Ask the orchestrator before running it; the deleted practice bots are gone.

## Replays

`play <biome>` writes `results/<id>-<biome>.replay.json`. Tell the team: run `yarn dev`, open http://127.0.0.1:3000, choose **Import**, pick the file, and watch tick N, where you name the tick that shows the special move. Use `yarn inspect ... --tick N --bot <id>` to find that tick yourself.
