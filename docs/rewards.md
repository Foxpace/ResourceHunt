# Rewards and achievements

Bots score by banking resources. Badges recognize achievements in the results, while tournament wins come from finishing first in a round.

## Banked points

| Resource | Points per item | Weight per item |
| -------- | --------------: | --------------: |
| Ore      |               2 |               1 |
| Crystal  |               7 |               2 |
| Relic    |              14 |               3 |

Cargo banks automatically at a bot's home base or an operational depot it owns. For example, banking one crystal and one relic earns 21 points and frees five units of carrying capacity. Resources gathered, stolen, or looted must reach a bank to count toward the score. Unbanked cargo still appears as carried value in the match results.

Match standings rank bots by points banked. Equal scores share a rank.

## Achievement badges

A category awards a badge only when its highest recorded value is positive. Bots tied for that value share the badge. Older replays can earn badges from the statistics they recorded.

| Category                | What it tracks                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Scoring and efficiency  | Total score and points per banking trip, item banked, or tile walked                                                                       |
| Movement and collection | Tiles walked, resources gathered, items banked, banking trips, cache items looted, and items taken from rivals and caches combined         |
| Rivalry                 | Depots captured or sabotaged, sabotage attempts and success rate, items and value stolen, traps placed or triggered, and trap success rate |
| Combat and defense      | Guardian defeats, guardian and drone hits individually and combined, depot repairs, and traps cleared                                      |
| Setbacks                | Cargo lost, guardian pushbacks, drone stuns, enemy traps sprung, and depot downtime                                                        |

The results show up to three standout badges by default. Standouts are selected by the winner's proportional lead over the next score in that category. Up to five more badges are drawn from the remaining earned categories using the match seed. Badge selection has no effect on match points or wins.

Change the badge limits under **Results and tournament options** in the browser, or use the CLI flags below. Each limit accepts values from zero to 30.

```sh
yarn play --standout-badges 2 --random-badges 4
```

## Tournament rewards

Each round gives one win to every bot tied for first. The tournament ends when a bot reaches the win target, which defaults to three. If several bots reach it in the same round, they share the tournament win.

The tournament table sorts by total points banked across all rounds and also shows round wins and badge counts. Each selected round badge counts once for every bot that earned it.

See the [competitive world rules](world.md) for details on depots, theft, and caches.
