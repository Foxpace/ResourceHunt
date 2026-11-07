---
name: resource-hunt-strategies
description: "Resource Hunt mechanics, exploitable numbers, SDK helpers, and strategy archetypes. Use when brainstorming bot ideas, offering solid/bold/wild options, stress-testing a decision order, or designing practice rivals."
---

# Resource Hunt strategies

Use this to turn a team's idea into sharper, real options. Every mechanic below exists; cite the source in the artifact when you rely on it. Never invent a rule. If you need a detail not listed, read the source.

This page is your knowledge, not chat material. Tell the team what the bot would visibly do and what it risks, in plain words. Helper names, numbers from this table, and engine details stay in artifacts and code.

## The simple bot's scores

Four copies of `nearest` (closest resource, bank when full) average **about 97 per match**: tundra 123, riverlands 116, volcanic 106, desert 97, archipelago 89, valley 84, moon 84, forest 75. Measured with the runner's `baseline`; do not rerun it. In chat, call it "a simple bot that grabs the closest resource".

## Numbers that shape strategy

| Fact                                                                                                                                                                                                         | Source                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 300 ticks, one action per decision; terrain costs 1-3 turns per tile.                                                                                                                                        | [sdk](../../../docs/sdk.md#terrain_cost)                                                                                                   |
| Ore 2 pts / 1 weight, crystal 7 / 2, relic 14 / 3. Bag holds 8. Value per weight: 2, 3.5, 4.7.                                                                                                               | [sdk](../../../docs/sdk.md#resources)                                                                                                      |
| Only banked cargo scores: base or an operational owned outpost. `home` walks to the cheapest owned bank.                                                                                                     | [sdk](../../../docs/sdk.md#actions)                                                                                                        |
| Resources never respawn. Hotspots are finite crystal/relic clusters.                                                                                                                                         | [sdk](../../../docs/sdk.md#resources-and-bot-state)                                                                                        |
| Outpost capture: 3 consecutive `capture` turns, then 3 rounds of immunity. The new owner banks its cargo at once.                                                                                            | [sdk](../../../docs/sdk.md#cancapturestate)                                                                                                |
| Theft: rival on your tile or one step away; takes its best fitting item; 5-tick cooldown; both get 2 ticks of protection. Base tiles block theft, outposts do not.                                           | [sdk](../../../docs/sdk.md#getstealtargetsstate-and-canstealstate-targetid)                                                                |
| Sabotage: adjacent enemy depot closed 6 ticks, 12-tick cooldown; a guarding owner blocks it; `repair` reopens.                                                                                               | [world](../../../docs/world.md#actions-and-defenses)                                                                                       |
| Traps: cost 1 ore, arm next tick, last 30 ticks, 8-tick cooldown, max 2. A loaded rival spills 1 item and loses a turn. Owners are immune.                                                                   | [world](../../../docs/world.md#actions-and-defenses)                                                                                       |
| Drones: 2 HP, chase exposed bots within 6 tiles and prefer loaded ones; a hit stuns and steals 1 item. Hold of 4 items, emptied 8 ticks after its first theft. A destroyed drone drops its hold on its tile. | [world](../../../docs/world.md#actions-and-defenses), strike handler in [guardian-caches.ts](../../../src/engine/world/guardian-caches.ts) |
| Guardian caches: 3-HP guardian, cache holds 2 relics + 2 crystals (42 pts). Unguarded nonlethal hits draw retaliation; the finishing hit does not. `lootCache` takes 1 item per turn.                        | [world](../../../docs/world.md#actions-and-defenses)                                                                                       |
| Natural events: first at tick 18, then forecast every 32 ticks with 4 ticks of warning; radius 5, last 7 ticks; impacts spill 1 item and delay exposed bots.                                                 | [world](../../../docs/world.md#natural-events)                                                                                             |
| `guard` lasts through the next tick and blocks theft, traps, guardians, drones, and impacts.                                                                                                                 | [world](../../../docs/world.md#actions-and-defenses)                                                                                       |
| Spilled cargo stays on the ground and anyone can `grab` it.                                                                                                                                                  | [world](../../../docs/world.md#actions-and-defenses)                                                                                       |
| Turn order rotates each tick; later bots see earlier bots' moves.                                                                                                                                            | [sdk](../../../docs/sdk.md#state-available-each-turn)                                                                                      |
| Badges reward theft, traps, sabotage, guardian kills, captures, and more, but do not add score.                                                                                                              | [rewards](../../../docs/rewards.md#achievement-badges)                                                                                     |
| Each decision must finish within 100 ms or the bot is disabled for the match.                                                                                                                                | [bot development](../../../docs/bot-development.md#match-lifecycle-and-determinism)                                                        |

## SDK helpers that make ideas cheap

- `distanceField(map, from)`: routes to every tile in one search. Use once per turn.
- `planTrip(state, pile, units)`: full trip with deadline check. Two searches per call, so only for a shortlist of about 3.
- `getNearestBank`, `canCapture`, `getStealTargets`, `getOpponentArrivalTimes`.
- Tactical helpers that return an `Action` or `undefined`: `getDefensiveAction` (evacuate hazards, dodge drones, retreat from guardians), `getCompetitiveAction` (repair, sabotage, cache combat, loot, traps), `getTrapAction`, `getGuardianFightAction`, `protectDroneCrossing`.
- Eligibility checks: `canSabotage`, `canRepair`, `canDeployTrap`, `canClearTrap`, `canStrike`, `canLootCache`, `getHazardsAt`.

Details: [SDK threat helpers](../../../docs/sdk.md#threat-and-competition-helpers).

## Archetypes to spark ideas

Measured on the dev `bench`: closest-first collection with banking at any owned bank beat `nearest` by about 17%, while chasing value per distance and leading with `getDefensiveAction` both scored far below it. Bold ideas need a guard against contested hotspots and over-caution; say so when you offer them.

Do not just list these. Mix them with the team's idea, invent new ones, and label each **solid**, **bold**, or **wild**. Wild means unusual tactics within the real rules. Offer each as one line the team could picture in a replay ("follows the richest rival and pickpockets it away from home"); the Exploits column is for you.

| Archetype                | Core move                                                                     | Exploits                   | Risk                         |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------------- | ---------------------------- |
| Value miner (solid)      | Rank piles by value per round-trip turn, not distance.                        | Relic value density        | Long trips near the end      |
| Forward banker (solid)   | Capture the outpost nearest the richest hotspot early, then shuttle.          | Short banking trips        | Rivals recapture or sabotage |
| Cache cracker (bold)     | Guard, strike a guardian three times, loot 42 points.                         | Guardian retaliation rules | Turns spent fighting         |
| Storm surfer (bold)      | Mine inside forecast zones while others flee; guard on impact ticks.          | Forecasts and `guard`      | One mistimed guard spills    |
| Pickpocket (wild)        | Shadow the richest loaded rival and steal when it is off its base.            | Theft, bases-only safety   | Cooldown, rivals bank first  |
| Drone scavenger (wild)   | Let drones rob rivals, then strike the drone twice and grab the dropped hold. | Drone hold drops on death  | Drone stuns you first        |
| Minefield (wild)         | Keep two traps on rivals' cheapest route home; collect what they spill.       | Traps and spilled cargo    | Only two traps, ore cost     |
| Depot vandal (wild)      | Sabotage a rival outpost just before its loaded owner arrives.                | Sabotage timing            | Guarding owners block it     |
| Last-minute heist (bold) | Carry only crystals and relics; bank exactly in time using `planTrip`.        | Deadline math              | One delay loses the bag      |

## Good scenarios for stress tests

Aim each at the weak point of the team's policy. Say them in relative words; keep exact numbers for yourself:

- Near the end of the match, bag full of relics, home is far away.
- A drone is close while the bag holds valuable crystals.
- A rival empties the target pile just before the bot arrives.
- A storm is about to hit the rich area the bot is mining.
- A rival took the team's outpost while the loaded bot walks toward it.
- The guardian is almost beaten and the bag is nearly full.
