---
name: bot-arena
description: "Benchmark, compare, replay, and hand in Resource Hunt bots: runner operations, lineups with practice bots, fair comparisons, practice tournaments, reading score tables, packing the hand-in zip, and evidence. Use whenever a workshop agent runs bench, holdout, play, tournament, pack, or raw yarn bench/play/tournament commands."
---

# Bot arena

Prove things with the game itself. The game CLI is the test suite: a bot that runs every biome with zero errors and banks more than its rivals works.

## The runner (saves evidence)

```sh
node .github/bot-workflow/run.mjs <stage> <bot-id> <operation> [biome] [--vs id,id,...] [--label name]
```

| Operation    | What it does                                                                  | Stages              | Time  |
| ------------ | ----------------------------------------------------------------------------- | ------------------- | ----- |
| `status`     | Which artifacts are missing, draft, or approved                               | all                 | 1 s   |
| `baseline`   | Four copies of `nearest` on every biome. Already measured, see below          | all                 | ~40 s |
| `bench`      | The team bot vs opponents on the 8 practice biomes                            | plan, build         | ~45 s |
| `play`       | One match saved as a replay in `results/`                                     | plan, build, review | ~3 s  |
| `check`      | Bot discovery, types, and structure rules, with advisory Prettier output      | build, review       | ~15 s |
| `format`     | Formats the team bot, its practice bots, and its team folder                  | build, review       | 2 s   |
| `holdout`    | `bench` on unseen maps: the final proof, once at the end of Build             | build               | ~80 s |
| `tournament` | Three tournaments (seeds `handin-1..3`, first to 3 round wins) with a summary | review              | ~20 s |
| `pack`       | Needs an approved REVIEW.md. Runs the checks and writes the ZIP               | review              | ~15 s |

- `--vs` replaces the default opponents (`nearest,nearest,nearest`). The team bot is always first. Up to 14 opponents; repeat an ID for copies. Time grows with lineup size.
- A biome argument focuses a benchmark and doubles its matches. In tournaments it selects the first biome in the rotation. Biomes are riverlands, valley, desert, moon, volcanic, archipelago, tundra, and forest.
- Evidence goes under `bots/<id>/_workflow/evidence/`. Benchmarks and tournaments save a text report and companion JSON. Use different labels such as `--label before` and `--label bank-earlier` to keep both reports when the lineup and biome stay the same. Labels do not change the seeds.
- Benchmark JSON has an overall `summary` and a `runs` entry per biome. The entry's `participants` maps instance IDs to strategy IDs. Each match in `data.results` has the exact seed, starting order, final stats, and a `scores` array. Tick zero comes first and the columns follow that match's `botOrder`.

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
yarn bench --bots comet,comet-greedy,nearest,nearest --matches 8 --biome forest --seed dev-x --json
yarn play --bots comet,nearest,nearest,nearest --biome moon --seed dev-y --replay results/comet-moon.replay.json
yarn tournament --bots comet,comet-thief,comet-greedy,nearest --wins 3
yarn inspect --input results/comet-moon.replay.json --tick 120 --bot comet --map
```

- Use a match count that is a multiple of the lineup size, so every bot starts from every base.
- Compare versions on the same seed, biome, and lineup.
- Never use a seed starting with `holdout` for tuning. Run the runner's `holdout` once, at the end of Build, as the final proof.
- Results that matter for an artifact must come from the runner, so they have evidence files.

## Reading a table

- Treat any error or timeout as a defect. Check rival errors too when interpreting wins.
- `mean` averages banked score across completed biomes. The details table shows score range, average rank, and the mean score difference against the highest-scoring rival in each match. Wins and shared firsts are separate counts. Copies of a strategy share one summary row.
- Check captures, theft, losses, and unbanked cargo against the intended strategy. Use match counters or a replay to check a suspected explanation.
- Use halfway points and first bank tick to check whether the bot starts banking earlier. First bank tick averages only starts that scored, so read it with the scoreless count. Compare points per tile and per deposit alongside total points and wins. The JSON includes median and spread of scores, the first-place rate including ties, and totals for every recorded game counter.
- Report how many maps were tested. Four matches with a four-bot lineup rotate through four bases on one map. When two versions are close, run the deciding biome on its own to include another map.
- Fixed seeds give the same result every time. Do not rerun hoping for a better number.

## Telling the team

Start with the result that affects the team's next choice. Include the opponent lineup and sample size, and use a small table if several biomes or versions matter. Explain the likely trade-off in plain words and cite the evidence in the artifact.

## Hand-in

- `tournament` puts the team bot first, then its practice bots and two copies of `nearest`. Use `--vs` to replace the opponents. The report shows every bot's final points, place, and round wins. It also tracks the team bot's points and cumulative wins by round. A shared first earns each leader a round win, and bots that reach the target together share the tournament win.
- Tournament JSON has one entry per seed. Use `progression` for each bot's round points, rank, cumulative points, and cumulative wins. Use `data.rounds` for the exact seed, starting order, per-tick scores, and final game counters. Cite the seed and round when a result supports the verdict.
- `pack` requires an approved REVIEW.md. It runs the checks and zips `bots/<id>.ts` and `bots/<id>/` into `results/<id>-handin.zip`. Practice bots stay on disk. After sharing the ZIP, offer optional cleanup in chat for the team's verified practice bots. Only remove exact paths the orchestrator explicitly approves.

## Replays

`play <biome>` writes `results/<id>-<biome>.replay.json`. Tell the team: run `yarn dev`, open http://127.0.0.1:3000, choose **Import**, pick the file, and watch tick N, where you name the tick that shows the special move. Use `yarn inspect ... --tick N --bot <id>` to find that tick yourself.
