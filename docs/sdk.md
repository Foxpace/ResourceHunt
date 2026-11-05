# Bot SDK

Import from `../src/sdk.ts` in a bot file. The SDK provides actions, state types, and helpers for movement, pathfinding, and inventory.

```ts
import {
  BIOMES,
  MAX_BOTS,
  DIRECTIONS,
  RESOURCES,
  TERRAIN_COST,
  distanceField,
  findPath,
  inventoryWeight,
  positionKey,
  samePosition,
  terrainCost,
  getMoveOptions,
  getInventoryStats,
  canGrab,
  planTrip,
  getOpponentArrivalTimes,
  getBankingSites,
  getNearestBank,
  canCapture,
  getStealTargets,
  canSteal,
  THEFT_PROTECTION_TICKS,
  type Biome,
  type BiomeDefinition,
  type Action,
  type Bot,
  type BotContext,
  type BotMetadata,
  type BotState,
  type Direction,
  type GameMap,
  type Observation,
  type Position,
  type ResourceKind,
  type ResourcePile,
  type Terrain,
  type Route,
  type MoveOption,
  type InventoryStats,
  type TripPlan,
  type TripFailure,
  type OpponentArrivalTime,
  type Hotspot,
  type Outpost,
  type BankingSite,
  type BankingRoute,
  type StealTarget,
} from "../src/sdk.ts";
```

Examples below assume they run inside `act(state: Observation)`, unless they define a full class. See the [README](../README.md#add-a-bot) for a starter bot.

## Quick reference

| Export                                                                               | Use                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------- |
| [`getMoveOptions(state)`](#getmoveoptionsstate)                                      | Terrain and cost for all four moves         |
| [`getInventoryStats(state)`](#getinventorystatsstate)                                | Carried weight, free capacity, and value    |
| [`canGrab(state)`](#cangrabstate)                                                    | Whether grabbing here would succeed         |
| [`planTrip(state, pile, units?)`](#plantripstate-pile-units)                         | Travel, collection, return, and feasibility |
| [`getOpponentArrivalTimes(state, position)`](#getopponentarrivaltimesstate-position) | Earliest rival arrival and next action      |
| [`terrainCost(map, position)`](#terraincostmap-position)                             | Turns needed to enter a tile                |
| [`DIRECTIONS`](#directions)                                                          | Coordinate offsets for N, W, E, S           |
| [`TERRAIN_COST`](#terrain_cost)                                                      | Cost lookup by terrain name                 |
| [`findPath(map, from, to)`](#findpathmap-from-to)                                    | Cheapest route to one destination           |
| [`distanceField(map, from, stopAt?)`](#distancefieldmap-from-stopat)                 | Routes to many destinations in one search   |
| [`positionKey(position)`](#positionkeyposition)                                      | Convert coordinates to a lookup key         |
| [`samePosition(a, b)`](#samepositiona-b)                                             | Compare coordinates                         |
| [`inventoryWeight(items)`](#inventoryweightitems)                                    | Total carried weight                        |
| [`RESOURCES`](#resources)                                                            | Resource values, weights, and colors        |
| [`getBankingSites(state)`](#getbankingsitesstate-and-getnearestbankstate-from)       | Owned bases and outposts                    |
| [`getNearestBank(state, from?)`](#getbankingsitesstate-and-getnearestbankstate-from) | Cheapest route to an owned bank             |
| [`canCapture(state)`](#cancapturestate)                                              | Whether capture can advance here            |
| [`getStealTargets(state)`](#getstealtargetsstate-and-canstealstate-targetid)         | Eligible cargo theft targets                |
| [`canSteal(state, targetId)`](#getstealtargetsstate-and-canstealstate-targetid)      | Whether theft from one rival can succeed    |
| `THEFT_PROTECTION_TICKS`                                                             | Two-tick theft protection window            |

## Biomes

`MAX_BOTS` is `15`, the shared lineup limit for the engine, CLI, UI, benchmarks, and replay importer.

`Biome` is `"riverlands" | "valley" | "desert" | "moon" | "volcanic" | "archipelago" | "tundra" | "forest"`.

`BIOMES` is a `Record<Biome, BiomeDefinition>`. Each definition contains `name`, `description`, `spawnTerrain`, and `connectorTerrain`. Spawn terrain is the one-turn ground cleared around bases and beneath outposts; connector terrain joins land across water when needed. The catalog is shared with the UI and CLI.

```ts
const biome = BIOMES[state.config.biome];
const moves = getMoveOptions(state); // Includes costs for this map's terrain.
```

## Actions

Return one `Action` per decision:

| Action                                         | Effect                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `{ type: "move", direction: "N" }`             | Move one tile. Direction can be `N`, `W`, `E`, or `S`.                                                      |
| `{ type: "grab" }`                             | Take one unit from the current tile if it fits.                                                             |
| `{ type: "home" }`                             | Move one step toward the cheapest owned bank.                                                               |
| `{ type: "skip" }`                             | Spend the turn in place.                                                                                    |
| `{ type: "capture" }`                          | Spend a turn capturing the outpost on your tile.                                                            |
| `{ type: "steal", targetId: "rival" }`         | Take one fitting cargo item from a rival on your tile or one orthogonal step away.                          |
| `{ type: "sabotage", targetId: "outpost-1" }`  | Disable adjacent enemy banking for six ticks. The depot then has a 12-tick cooldown starting at the attack. |
| `{ type: "repair", targetId: "outpost-1" }`    | Restore a nearby owned depot and cancel sabotage.                                                           |
| `{ type: "deployTrap" }`                       | Spend one ore to place a visible trap on your tile.                                                         |
| `{ type: "clearTrap", targetId: "trap-10-0" }` | Remove a trap on your tile or an adjacent tile.                                                             |
| `{ type: "guard" }`                            | Protect cargo and prevent threat delays through the following tick.                                         |
| `{ type: "strike", targetId: "drone-1" }`      | Deal one damage to an adjacent drone or cache guardian.                                                     |
| `{ type: "lootCache", targetId: "cache-1" }`   | Take one fitting item while on a defeated guardian's cache.                                                 |

See [competitive world](world.md) for costs, cooldowns, forecasts, enemy behavior, and defenses.

Returning `home` does not schedule future actions. Return it again on later turns to continue home. Arrival at your base or an operational owned outpost automatically banks all cargo. `home` selects the cheapest owned banking site each turn.

A blocked move, empty grab, or grab that exceeds capacity consumes the turn. An invalid action or thrown error is recorded as a bot error. A decision timeout disables the worker for the rest of the match.

### Movement timing

The bot's position updates immediately on a valid move. Any extra terrain cost becomes `travelRemaining`, and the engine spends those extra turns automatically before calling `act` again.

For example, entering a mountain takes the current turn plus two travel turns. The bot can grab a resource there on its next decision. Bots may share tiles, so other bots do not block a route.

## State available each turn

`Observation` is a fresh copy of the game state at the start of your decision. Changing it does not change the engine. Keep persistent strategy memory in your class fields.

| Field            | Type             | Meaning                                              |
| ---------------- | ---------------- | ---------------------------------------------------- |
| `config`         | Object           | Match settings listed below                          |
| `tick`           | `number`         | Zero-based tick, from `0` to `maxTicks - 1`          |
| `maxTicks`       | `number`         | Configured match length                              |
| `remainingTicks` | `number`         | Ticks left, including the current tick               |
| `capacity`       | `number`         | Maximum inventory weight                             |
| `map`            | `GameMap`        | Full terrain grid                                    |
| `resources`      | `ResourcePile[]` | All remaining piles                                  |
| `hotspots`       | `Hotspot[]`      | Finite high-value resource clusters                  |
| `outposts`       | `Outpost[]`      | Ownership and capture progress for forward banks     |
| `world`          | `WorldState`     | Visible traps, drones, caches, hazards, and defenses |
| `bots`           | `BotState[]`     | Every bot, in the original lineup order              |
| `self`           | `BotState`       | Your bot's current state                             |

`world` contains `traps`, `drones`, `caches`, `hazards`, and per-bot `defenses`. These arrays are fully visible to every bot and are recorded each tick. Drone routes show their current planned movement. Hazards include exact cells, `announcedAt`, `startsAt`, and `endsAt`. `state.map` includes active temporary terrain, so normal pathfinding respects lava, meteors, and storms.

`config` contains `biome`, `width`, `height`, `ticks`, `seed`, `baseLayout`, `resourceDensity`, `terrainDensity`, `capacity`, `decisionTimeoutMs`, `hotspotCount`, `outpostCount`, `captureTurns`, `captureImmunityTicks`, `stealing`, `stealCooldownTicks`, `sabotage`, `cargoTraps`, `scavengerCount`, `guardianCount`, and `naturalEvents`. `baseLayout` is `"edges"` or `"center"`.

Every bot sees the entire map. Turns resolve sequentially and starting order rotates each tick; later bots see earlier bots' changes in the same tick. Workers are not called during automatic travel turns or after being disabled.

### Coordinates and map

`Position` is `{ x: number; y: number }`. Use integer coordinates. The top-left tile is `{ x: 0, y: 0 }`; east increases `x`, south increases `y`.

`GameMap` contains `width`, `height`, and `tiles`. Read terrain with `map.tiles[y][x]`. Tile names depend on the biome. Read `state.config.biome` for the `Biome` ID. The [terrain cost table](maps.md#terrain-costs) lists every `Terrain`; existing pathfinding helpers support all of them.

### Resources and bot state

`ResourcePile` is `{ x, y, kind, amount }`. `kind` is a `ResourceKind`: `"ore"`, `"crystal"`, or `"relic"`. `amount` counts remaining units, not their total weight or value.

`state.hotspots` contains `Hotspot[]`: `{ id, x, y, radius }`. Each marks a finite crystal/relic cluster; `ResourcePile.hotspotId` identifies its stock. Resources never respawn.

`state.outposts` contains `Outpost[]`: `{ id, x, y, ownerId, capturingBotId, captureProgress }`. The optional fields `captureProtectedUntilTick`, `disabledUntilTick`, and `sabotageProtectedUntilTick` give the expiry ticks for capture immunity, bank downtime, and sabotage cooldown. Old replays may also have `sabotagingBotId` and `sabotageProgress`. Ownership and progress update during turns. Neutral ownership and no active capturer use `null`.

`BotState` contains:

| Fields                      | Meaning                                             |
| --------------------------- | --------------------------------------------------- |
| `id`, `name`, `description` | Bot metadata                                        |
| `color`                     | Display color                                       |
| `position`, `base`          | Current tile and home tile, both `Position`         |
| `inventory`                 | Array of `ResourceKind`, one entry per carried unit |
| `score`                     | Banked resource value                               |
| `delivered`                 | Number of resource units banked                     |
| `travelRemaining`           | Automatic travel turns still owed                   |
| `errors`                    | Number of invalid or failed decisions               |
| `lastAction`                | Human-readable status text                          |
| `disabled`                  | Whether the bot has stopped participating           |

Additional bot fields are `stealReadyTick`, `theftProtectedUntilTick`, `captures`, `stolen`, and `lost`. Counters count completed captures and individual cargo units. A bot can attempt theft when `state.tick >= self.stealReadyTick`; protected targets require `state.tick >= target.theftProtectedUntilTick`.

Use `inventoryWeight(self.inventory)` for capacity checks. Inventory length counts units, whose weights differ. Treat `lastAction` as display text rather than a structured action record.

## Decision helpers

These helpers read the supplied state without mutating it or choosing an action for you.

### `getMoveOptions(state)`

Returns a `MoveOption[]` in `N`, `W`, `E`, `S` order, including blocked moves.

| Field         | Meaning                                  |
| ------------- | ---------------------------------------- |
| `direction`   | Direction to put in a move action        |
| `destination` | Neighboring `Position`                   |
| `terrain`     | Terrain name, or `null` outside the map  |
| `cost`        | Turns to enter, or `Infinity` if blocked |
| `passable`    | Whether the destination is traversable   |

`passable` describes terrain; it does not account for a disabled bot or an outstanding travel delay.

```ts
const moves = getMoveOptions(state).filter((move) => move.passable);
const cheapest = moves.sort((a, b) => a.cost - b.cost)[0];
return cheapest
  ? ({ type: "move", direction: cheapest.direction } satisfies Action)
  : ({ type: "skip" } satisfies Action);
```

### `getInventoryStats(state)`

Returns `InventoryStats` with `units`, `weight`, `capacity`, `freeWeight`, and `carriedValue`. The last field is the value of inventory still waiting to be banked, separate from `self.score`.

```ts
const bag = getInventoryStats(state);
if (bag.weight > 0 && bag.freeWeight === 0) return { type: "home" } satisfies Action;
```

### `canGrab(state)`

Returns `true` when the current tile has a remaining resource unit that fits in the bag and the bot can act now. Returns `false` for missing resources, insufficient capacity, travel delays, disabled bots, or no remaining ticks.

```ts
if (canGrab(state)) return { type: "grab" } satisfies Action;
```

### `planTrip(state, pile, units?)`

Plans the cheapest outbound route, the requested grabs, and a return to the nearest owned bank. `units` defaults to `1` and must be a positive safe integer; invalid counts throw `RangeError`.

Returns a `TripPlan`:

| Field                  | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `units`                | Requested resource units                                                |
| `outbound`, `homeward` | Weighted `Route` objects, or `null` if unreachable                      |
| `bank`                 | Selected `BankingSite`, or `null` if unreachable                        |
| `travelTurns`          | Travel turns, including any current delay                               |
| `grabTurns`            | One turn per requested unit                                             |
| `totalTurns`           | Turns until the planned resources are banked; `Infinity` if unreachable |
| `resourceValue`        | Value of the requested new units                                        |
| `bankedValue`          | Value of those units plus the inventory already carried                 |
| `feasible`             | Whether this plan fits the current state and deadline                   |
| `reasons`              | `TripFailure[]`, empty when feasible                                    |

Reasons are `"disabled"`, `"missing-resource"`, `"insufficient-resources"`, `"capacity"`, `"unreachable"`, and `"deadline"`. More than one can apply. Requested values and route estimates remain available when a plan is infeasible.

Availability comes from the current `state.resources`, not the passed pile's potentially stale amount. Capacity accounts for unloading when the returned outbound route passes through any owned bank. If collecting at home, each grab banks immediately. Banking on arrival does not wait for a bank tile's extra terrain delay. The returned `bank` is a `BankingSite`, or `null` if no bank is reachable. Ownership may change, so replan after rivals capture outposts.

A trip that takes exactly `remainingTicks` is feasible. Follow the returned routes to match its timing; taking a different route can change whether you pass home and unload. Other bots can still take the resources first.

```ts
const pile = state.resources[0];
if (pile) {
  const trip = planTrip(state, pile, Math.min(2, pile.amount));
  if (trip.feasible) {
    if (canGrab(state) && samePosition(state.self.position, pile)) {
      return { type: "grab" } satisfies Action;
    }
    const direction = trip.outbound?.steps[0];
    if (direction) return { type: "move", direction } satisfies Action;
  }
}
return { type: "home" } satisfies Action;
```

Each call runs two pathfinding searches. For large maps, use `distanceField` to shortlist targets before planning full trips, or increase the decision timeout.

### `getOpponentArrivalTimes(state, position)`

Returns one `OpponentArrivalTime` per other bot, assuming each immediately follows a cheapest route to the target.

| Field         | Meaning                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| `botId`       | Opponent ID                                                                  |
| `route`       | Route from its current position; `null` if unreachable                       |
| `arrivalTick` | Earliest zero-based tick when its position could reach the target            |
| `readyTick`   | Earliest zero-based tick when it could call `act` there, for example to grab |
| `turnOrder`   | Its zero-based turn order within `readyTick`, counting all bots              |

The estimates include `travelRemaining` and whether the opponent has already acted in the current tick. Results are sorted by `readyTick`, then `turnOrder`, so resource races include rotating initiative.

Arrival and readiness differ. A bot one mountain tile away can enter it on its next turn, then owes two travel turns before it can grab. An opponent already on the target has `arrivalTick === state.tick`; its next decision may still be delayed.

Disabled or unreachable opponents have `Infinity` for all timing fields. Estimates can extend past the match deadline; `readyTick < state.maxTicks` is required to take an action there before the match ends. They do not predict intentions, detours, grabbing en route, or future changes in resource availability.

```ts
const target = state.resources[0];
if (target) {
  const rivals = getOpponentArrivalTimes(state, target);
  const first = rivals.find((rival) => rival.readyTick < state.maxTicks);
  const ticksUntilRivalCanGrab = first ? first.readyTick - state.tick : Infinity;
}
```

## Competitive play

### `getBankingSites(state)` and `getNearestBank(state, from?)`

`getBankingSites` returns your base and owned outposts as `BankingSite[]`. Each has `{ id, kind, x, y }`, with `kind` equal to `"base"` or `"outpost"`. A base ID is `base:<bot-id>`; outpost IDs match `state.outposts`.

`getNearestBank` returns `{ site, route }` or `null` if none is reachable. `from` defaults to your current position. Ties favor the base, then outpost order. `home` and `planTrip` use the same banking policy.

```ts
const bank = getNearestBank(state);
if (state.self.inventory.length && bank && bank.route.cost + 1 >= state.remainingTicks) {
  return { type: "home" } satisfies Action;
}
```

### `canCapture(state)`

Returns whether a capture action can advance the outpost on your tile. You must be ready to act, must not already own it, its ownership protection must have expired, and no other active bot may occupy it. Disabled bots do not block capture.

Return `capture` for `config.captureTurns` consecutive turns, default `3`. Taking another action, leaving, failing a decision, or an active rival entering resets progress. Ownership remains with the previous owner until capture completes. The new owner banks existing cargo immediately. Repeating capture on an owned outpost awards nothing. Each completed capture grants `captureImmunityTicks` full following rounds of protection against recapture and sabotage, default `3`. Zero disables this protection. `captureProtectedUntilTick` is the first tick on which rivals can act again; `isOutpostProtected(outpost, tick)` checks the current window. Owners can still bank and repair during protection.

```ts
if (canCapture(state)) return { type: "capture" } satisfies Action;
```

### `getStealTargets(state)` and `canSteal(state, targetId)`

`getStealTargets` returns eligible rivals on your tile or one orthogonal step away, sorted by descending item value. Each `StealTarget` has `{ botId, kind, value, weight }`, describing the highest-value item that fits in your free capacity. `canSteal` checks eligibility for one target.

```ts
const target = getStealTargets(state)[0];
if (target) return { type: "steal", targetId: target.botId } satisfies Action;
```

A successful theft transfers exactly one unit and consumes the turn. It requires `config.stealing`, available bag capacity, a ready thief, an expired thief cooldown, and an unprotected target. Either participant standing on any base tile prevents theft. Outposts are not safe zones. Disabled rivals' unbanked cargo can be looted.

Successful theft at zero-based tick `t` sets `stealReadyTick` to `t + config.stealCooldownTicks`, default `5`. Both participants receive `theftProtectedUntilTick = t + THEFT_PROTECTION_TICKS`, with `THEFT_PROTECTION_TICKS === 2`. This protects them during the theft tick and the following tick, giving them a turn to leave before a steal-back. Failed attempts consume a turn without transferring cargo or starting a new cooldown.

The helper reflects the current observation. A rival can move away or bank cargo before your next turn. Score changes only when stolen cargo is banked; theft preserves total resource units.

## Movement helpers

### `DIRECTIONS`

Type: `Record<Direction, Position>`.

| Direction | Offset            |
| --------- | ----------------- |
| `N`       | `{ x: 0, y: -1 }` |
| `W`       | `{ x: -1, y: 0 }` |
| `E`       | `{ x: 1, y: 0 }`  |
| `S`       | `{ x: 0, y: 1 }`  |

### `terrainCost(map, position)`

Returns a `number`: the turn cost of entering the destination tile. Water, cliffs, lava, thickets, and positions outside the map return `Infinity`.

Check the cost of a northward move:

```ts
const delta = DIRECTIONS.N;
const destination = {
  x: state.self.position.x + delta.x,
  y: state.self.position.y + delta.y,
};
const cost = terrainCost(state.map, destination);

if (Number.isFinite(cost)) return { type: "move", direction: "N" } satisfies Action;
return { type: "skip" } satisfies Action;
```

### `TERRAIN_COST`

Lookup table used by movement and pathfinding:

| Terrain                                                 | Turns to enter |
| ------------------------------------------------------- | -------------: |
| `grass`, `bridge`, `oasis`, `regolith`, `basalt`, `ice` |              1 |
| `forest`, `sand`, `crater`, `ash`, `snow`               |              2 |
| `mountain`, `dune`                                      |              3 |
| `water`, `cliff`, `lava`, `thicket`                     |     `Infinity` |

Mountains and dunes are reachable. Water needs a bridge or an ice crossing. Use `terrainCost` when you also need bounds checking. See [maps](maps.md) for biome layouts and generation rules.

## Pathfinding

### `findPath(map, from, to)`

Accepts a `GameMap` and two `Position` values. Returns `{ cost: number; steps: Direction[] }`, or `null` when the destination cannot be reached.

- `cost` sums the cost of entering each route tile, including the destination and excluding the starting tile.
- `steps` is the sequence of cardinal moves. The cheapest route may have more steps than a more direct route through rough terrain.
- If already at the destination, the result is `{ cost: 0, steps: [] }`.
- Routes account for terrain, not grabbing, resource availability, or an existing travel delay.

Move toward a resource:

```ts
const target = state.resources[0];
if (!target) return { type: "skip" } satisfies Action;

const route = findPath(state.map, state.self.position, target);
const direction = route?.steps[0];
return direction
  ? ({ type: "move", direction } satisfies Action)
  : ({ type: "skip" } satisfies Action);
```

Check whether there is enough time to collect one unit and bank it:

```ts
const target = state.resources[0];
if (target) {
  const outward = findPath(state.map, state.self.position, target);
  const home = findPath(state.map, target, state.self.base);
  const needed = (outward?.cost ?? Infinity) + 1 + (home?.cost ?? Infinity);
  const fits =
    inventoryWeight(state.self.inventory) + RESOURCES[target.kind].weight <= state.capacity;
  const feasible = fits && needed <= state.remainingTicks;
  // The extra turn is for grab. Other bots may collect the target first.
}
```

### `distanceField(map, from, stopAt?)`

Returns a `Map<string, { cost: number; steps: Direction[] }>` from one pathfinding search. Keys come from `positionKey`. Unreachable positions have no entry. The origin has cost `0` and no steps.

Use it when comparing many resource targets:

```ts
const routes = distanceField(state.map, state.self.position);
let target: ResourcePile | undefined;
let cheapest = Infinity;

for (const pile of state.resources) {
  if (inventoryWeight(state.self.inventory) + RESOURCES[pile.kind].weight > state.capacity)
    continue;
  const cost = routes.get(positionKey(pile))?.cost ?? Infinity;
  if (cost < cheapest) {
    target = pile;
    cheapest = cost;
  }
}

if (target && samePosition(target, state.self.position)) return { type: "grab" } satisfies Action;
const direction = target && routes.get(positionKey(target))?.steps[0];
return direction
  ? ({ type: "move", direction } satisfies Action)
  : ({ type: "skip" } satisfies Action);
```

Omit `stopAt` to obtain final routes to every reachable tile. If supplied, the search may stop when that position is reached. Only the route to `stopAt` is guaranteed optimal in that case; other entries can be incomplete or tentative.

### `positionKey(position)`

Returns `"x,y"`. Use it for distance-field lookups, sets, or persistent coordinate memory. Resource piles can be passed directly because they also have `x` and `y`.

```ts
const key = positionKey({ x: 3, y: 7 }); // "3,7"
const visited = new Set<string>();
visited.add(positionKey(state.self.position));
```

### `samePosition(a, b)`

Returns `true` when both coordinates match. Object identity is irrelevant.

```ts
const atHome = samePosition(state.self.position, state.self.base);
const here = state.resources.find((pile) => samePosition(pile, state.self.position));
```

## Inventory and resource helpers

### `inventoryWeight(items)`

Accepts a readonly array of `ResourceKind` and returns its total weight. An empty inventory weighs `0`.

```ts
const load = inventoryWeight(state.self.inventory);
const freeWeight = state.capacity - load;
const pile = state.resources[0];
const fits = pile !== undefined && RESOURCES[pile.kind].weight <= freeWeight;
```

### `RESOURCES`

Type: `Record<ResourceKind, { value: number; weight: number; color: string }>`.

| Kind      | Banked value per unit | Weight per unit | Color     |
| --------- | --------------------: | --------------: | --------- |
| `ore`     |                     2 |               1 | `#e3b46c` |
| `crystal` |                     7 |               2 | `#75ded4` |
| `relic`   |                    14 |               3 | `#c5a2ff` |

Calculate the value currently carried:

```ts
const carriedValue = state.self.inventory.reduce((sum, kind) => sum + RESOURCES[kind].value, 0);
```

Carried value only becomes score when deposited at your base or an owned outpost.

## Bot lifecycle and randomness

`Bot` requires `act(state: Observation): Action | Promise<Action>`. The same class instance persists throughout a match, and every new match creates a fresh instance. Async decisions have the same timeout as synchronous decisions.

Default-export the class and give it static `BotMetadata` with `id`, `name`, and `description`. IDs must contain 1 to 48 lowercase letters, digits, or hyphens and start with a letter or digit. Names must contain 1 to 60 characters and cannot be blank. Descriptions may contain up to 300 characters.

`BotContext` provides `random(): number`, returning a seeded value in `[0, 1)`. Accept it in an optional constructor:

```ts
export default class RandomBot implements Bot {
  static metadata: BotMetadata = {
    id: "random-example",
    name: "Random example",
    description: "Chooses a cardinal direction with seeded randomness.",
  };

  constructor(private context: BotContext) {}

  act(state: Observation): Action {
    const directions: Direction[] = ["N", "W", "E", "S"];
    const direction = directions[Math.floor(this.context.random() * directions.length)]!;
    return { type: "move", direction };
  }
}
```

`Math.random` uses the same seeded generator inside the worker. Keep bot code, seeds, lineup, and configuration fixed for repeatable decisions; clocks, external input, and wall-clock timeouts can change outcomes.

## Exported types

| Type                  | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `Action`              | Union of move, grab, skip, home, capture, and steal actions      |
| `Bot`                 | Decision method contract                                         |
| `BotContext`          | Seeded random source passed to the constructor                   |
| `BotMetadata`         | Bot ID, display name, and description                            |
| `BotState`            | Position, base, inventory, score, and runtime status             |
| `Direction`           | `"N"`, `"W"`, `"E"`, `"S"`                                       |
| `GameMap`             | Grid dimensions and terrain tiles                                |
| `Observation`         | Current state passed to `act`                                    |
| `Position`            | Integer `x`, `y` coordinates                                     |
| `ResourceKind`        | `"ore"`, `"crystal"`, `"relic"`                                  |
| `ResourcePile`        | Coordinates, resource kind, and remaining unit count             |
| `Terrain`             | Terrain names used in the map                                    |
| `Route`               | Weighted cost and cardinal steps returned by pathfinding         |
| `MoveOption`          | Direction, destination, terrain, cost, and passability           |
| `InventoryStats`      | Unit count, weight, capacity, free weight, and value             |
| `TripPlan`            | Routes, turn counts, value, and trip feasibility                 |
| `TripFailure`         | Reasons a trip cannot currently complete                         |
| `OpponentArrivalTime` | Rival route, arrival tick, readiness tick, and turn order        |
| `Hotspot`             | Position, ID, and radius of a finite high-value resource cluster |
| `Outpost`             | Position, owner, active capturer, and capture progress           |
| `BankingSite`         | Position, ID, and kind of an owned bank                          |
| `BankingRoute`        | Selected banking site and its weighted route                     |
| `StealTarget`         | Eligible rival and highest-value fitting cargo item              |

See [`src/sdk.ts`](../src/sdk.ts) for the public exports and [`src/engine/types.ts`](../src/engine/types.ts) for the complete type definitions.

## Threat and competition helpers

| Helper                                    | Purpose                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `canSabotage(state, targetId)`            | Check enemy ownership, range, depot cooldown, and the owner's guard.                                             |
| `canRepair(state, targetId)`              | Check whether a damaged owned depot is within one tile.                                                          |
| `canDeployTrap(state)`                    | Check ore, cooldown, active trap limit, and protected sites.                                                     |
| `canClearTrap(state, targetId)`           | Check range to a visible trap.                                                                                   |
| `canStrike(state, targetId)`              | Check whether a living drone or guardian is within one tile.                                                     |
| `canLootCache(state, targetId)`           | Check guardian defeat, position, and capacity for the next item.                                                 |
| `getHazardsAt(state, position)`           | Read active or forecast hazards covering a tile.                                                                 |
| `getDefensiveAction(state)`               | Suggest evacuation, clearing an unarmed trap under your cargo, stepping off a drone, or retreat from a guardian. |
| `protectDroneCrossing(state, action)`     | Suggest guarding before an intended step onto a drone that can attack.                                           |
| `getGuardianFightAction(state, targetId)` | Choose whether to guard or strike an adjacent guardian.                                                          |
| `getTrapAction(state)`                    | Suggest placing an ore trap on a loaded rival’s likely route to a bank.                                          |
| `getCompetitiveAction(state)`             | Suggest nearby repair, sabotage, cache combat, looting, or a useful trap.                                        |
| `getHazardMap(map, world, tick)`          | Derive temporary terrain from a base map and recorded world state.                                               |

Eligibility helpers also check disabled bots, travel delays, and remaining turns. Optional tactical helpers return an `Action` or `undefined`; your strategy can use them before its normal collection logic:

```ts
const defense = getDefensiveAction(state);
if (defense) return defense;

const competition = getCompetitiveAction(state);
if (competition) return competition;
```

`getBankingSites`, `getNearestBank`, and `planTrip` exclude disabled depots. Replan when ownership, sabotage, or hazard forecasts change. Bases remain available for banking. `CLASSIC_WORLD_RULES` disables all five new mechanics when creating a classic match; `DEFAULT_WORLD_RULES` enables them with two drones and two caches.

## Multiple copies of a bot

Choose a copy count beside each strategy in the UI, or repeat IDs in the CLI:

```sh
yarn play --bots nearest,nearest,raider,strategist
```

Each copy runs in its own worker, with separate class fields, module state, and a seeded random stream. Replicas receive unique participant IDs such as `nearest-copy-1` and `nearest-copy-2`, names such as `Scout #1`, separate colors, bases, inventories, and standings. Their `strategyId` retains the original catalog ID, such as `nearest`. A strategy selected once keeps its existing ID and name.

Use `state.self.id` for your participant's identity. The class's static `metadata.id` identifies the strategy and can differ from the participant ID when copies are running. Ownership, capture progress, theft targets, events, and replay references all use participant IDs.

Programmatic `createGame` and `runBenchmark` accept repeated descriptors. `createBotLineup(descriptors)` is available if you need the stable participant identities before running a match. Benchmarks assign identities before rotating base slots, keeping each copy's results separate. The total limit of 15 includes every copy, and map-size requirements use that total. Repeated descriptors create new workers; `new Game(controllers)` still expects distinct controllers with unique IDs.
