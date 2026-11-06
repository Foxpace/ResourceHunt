# Competitive world

Matches include depot sabotage, visible cargo traps, scavenger drones, biome hazards, and guardian-controlled caches. All threats and their state are visible to every bot. They use the match seed and tick clock, so headless runs and replays reproduce the same simulation.

## Depot ownership

Any bot can recapture an enemy-owned depot using the normal consecutive `capture` actions once the tile is uncontested. Each new owner receives three full following rounds of immunity against recapture and sabotage. Banking and repair remain available during protection. A blue shield and countdown show the remaining window, and the tile tooltip gives its expiry tick.

Set `captureImmunityTicks` under Advanced, or use `--capture-immunity 3`. The range is zero to 20; zero disables protection. An interrupted capture does not change ownership or renew protection. Every completed recapture starts a new window for its new owner. Older replays import with their original unprotected capture behavior.

## Actions and defenses

| Mechanic         | Attack or reward                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Defense                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depot sabotage   | One `sabotage` action within one orthogonal tile of an enemy-owned depot disables its bank for six ticks. That depot cannot be sabotaged again until 12 ticks after the attack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The owner can `repair` within one tile to reopen the bank early. The cooldown survives repair. A nearby guarding owner blocks sabotage, and the home bank stays available.                                                                                                                        |
| Cargo traps      | `deployTrap` spends one ore on your current tile. It arms on the next tick, expires after 30 ticks, and has an eight-tick tool cooldown. Each bot may keep two active traps. A loaded rival triggers it by entering the tile or by standing on it when a tick starts. The trap spills one item, delays movement by one turn, and is consumed.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Clear it from the same or an adjacent tile, avoid it, or guard before crossing. Traps cannot be placed in protected starting areas, on depots, or on cache tiles. Owners do not trigger their own traps.                                                                                          |
| Scavenger drones | Two-HP drones move one tile every three ticks, beginning at tick six. They pursue exposed bots within six tiles, moving every second tick while chasing, and patrol near their post when no target is available. Every tick, a drone checks for a bot on its tile, even while waiting to move. It checks again after moving. A hit stuns for one turn and steals one carried item, with a six-tick cooldown between attacks. Drones favor bots with cargo when there is space in their four-item hold. Each drone has a hidden, randomized leash. It abandons a chase once it strays too far from its post or after a successful hit, returns, and tries again after a random delay. The leash length and delay are not exposed to bots. The stash disappears eight ticks after its first theft. | Protected starting areas and `guard` prevent the stun and theft. `strike` deals one damage within one tile. Keep moving away from a chasing drone, or guard when it is on or next to you. Its planned route is visible.                                                                           |
| Guardian caches  | A guarded hotspot starts with a cache at its center, a three-HP guardian, two relics, and two crystals. Guardians patrol up to three tiles from their cache and pursue intruders. They repel exposed adjacent bots at most once every three ticks, pushing them three or four tiles outward where terrain allows, spilling one item, and delaying movement.                                                                                                                                                                                                                                                                                                                                                                                                                                      | Guard before striking a ready guardian. An unguarded nonlethal hit can draw retaliation. A finishing hit ends the fight before the guardian can retaliate. After three hits, stand on the cache and `lootCache` one fitting item per turn. Empty caches and defeated guardians do not regenerate. |

Each hotspot can host one guardian cache. The guardian setting limits how many hotspots start guarded.

`guard` lasts through the complete following tick. It protects cargo from theft, traps, guardians, and natural impacts, and prevents their extra delays. It does not make lava traversable. All combat actions consume a normal decision turn. Range is Manhattan distance, so diagonals are not adjacent. Spilled cargo stays on the ground and can be recovered; trap construction consumes its ore.

## Natural events

The first event is forecast from match creation for tick 18. Later forecasts appear every 32 ticks and give four ticks of warning. Each event covers a five-tile Manhattan radius, up to 61 cells before protected sites and blocked terrain are excluded. Its affected cells are visible during the forecast, and the event lasts seven ticks. Impacts spill one item and delay exposed bots. Temporary terrain can change routes while an event is active; the original terrain returns afterward.

| Biome       | Event                                  | Temporary terrain         |
| ----------- | -------------------------------------- | ------------------------- |
| Riverlands  | Thunderstorm                           | Slow wooded ground        |
| Valley      | Thunderstorm                           | Slow wooded ground        |
| Desert      | Sandstorm                              | Dunes                     |
| Moon        | Meteor shower                          | Craters                   |
| Volcanic    | Alternating lava surges and boulders   | Blocked lava or mountains |
| Archipelago | Ocean squall                           | Slow storm-covered ground |
| Tundra      | Blizzard                               | Snow                      |
| Forest      | Alternating thunderstorms and wildfire | Slow wooded ground or ash |

Forecasts exclude bases and their three-tile opening area, bridges, depots, and cache tiles. Events never permanently cut routes. Bots already inside a lava impact can still issue a direct move to an adjacent safe tile, guard, or wait for the lava to clear. The SDK's `getDefensiveAction` suggests evacuation before impact and handles temporary blocked starting tiles without requiring pathfinding from lava.

## Settings

Advanced settings in the browser expose each mechanic. CLI equivalents are:

```sh
yarn play --sabotage true --cargo-traps true --scavengers 2 --guardians 2 --natural-events true
```

Drone and cache counts range from zero to six. Resource-free matches do not create caches. New matches enable all mechanics; turn them off explicitly for classic behavior:

```sh
yarn play --sabotage false --cargo-traps false --scavengers 0 --guardians 0 --natural-events false
```

The corresponding configuration fields are `sabotage`, `cargoTraps`, `scavengerCount`, `guardianCount`, and `naturalEvents`. Programmatic callers can spread `CLASSIC_WORLD_RULES` into their configuration. Replays from earlier versions import with empty world state and these mechanics disabled.

## Watching matches

Drone routes, guardian health, armed traps, depot damage, and hazard countdowns appear on the map. Hover a tile for health, cargo, arming times, and repair status. The status strip shows the forecast and remaining threats. Movement, combat bursts, score effects, and weather animation use a separate display clock; pausing or scrubbing never advances the engine. System reduced-motion preferences disable animation.

The [SDK reference](sdk.md#threat-and-competition-helpers) describes action eligibility and optional tactical helpers. All world state is cloned into observations and recorded into each replay frame. Remaining resource totals include stock still held by drones and caches.
