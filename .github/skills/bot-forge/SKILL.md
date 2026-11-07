---
name: bot-forge
description: "Write Resource Hunt bots fast: the single-file final bot and local practice bots (rivals and one-setting versions), with a decision-order skeleton, SDK patterns, structure rules, and common bugs. Use when creating or changing any bots/*.ts file in the workshop."
---

# Bot forge

## Files

| Kind             | File                       | Metadata `id`      | Handed in             |
| ---------------- | -------------------------- | ------------------ | --------------------- |
| Final bot        | `bots/<id>.ts`             | `<id>`             | yes                   |
| Practice version | `bots/<id>-<setting>.ts`   | `<id>-<setting>`   | no, deleted by `pack` |
| Practice rival   | `bots/<id>-<archetype>.ts` | `<id>-<archetype>` | no, deleted by `pack` |

Practice bots are your tools, not the team's decisions. Mention them in one line ("I added two practice rivals") and never ask the team to pick kinds or explain how they work.

- Every bot is one self-contained file. Import only from `../src/sdk.ts`. Never import from another bot file; the final bot must work alone.
- No tests are needed. The game CLI is the proof (see the [bot-arena skill](../bot-arena/SKILL.md)).
- [AGENTS.md](../../../AGENTS.md) rules apply to every bot file and `check` enforces them: functions at most 30 lines and 3 parameters, nesting at most 2, and compound `if` conditions built only from named booleans (`const late = ...; if (hasCargo && late)`), at most three.
- After writing, run `format`, then `check`. Fix structure failures by splitting functions.

## Decision-order skeleton

Each step of DESIGN.md's decision order becomes one function that returns an `Action` or `undefined`. The `??` chain is the decision order, so the code reads like the design. As written, this skeleton averaged 106 vs 90 for three copies of `nearest` on the dev `bench`, with zero errors: a solid floor to build the team's idea on.

```ts
import {
  canGrab,
  distanceField,
  getBankingSites,
  getInventoryStats,
  positionKey,
  RESOURCES,
  type Action,
  type Bot,
  type Observation,
  type Route,
} from "../src/sdk.ts";

type Routes = Map<string, Route>;
const HOME_MARGIN = 3;
const BANK_WHEN_FREE_WEIGHT_BELOW = 2;

export default class Comet implements Bot {
  static metadata = {
    id: "comet",
    name: "Comet",
    description: "One sentence on the policy, at most 300 characters.",
  };

  act(state: Observation): Action {
    const routes = distanceField(state.map, state.self.position);

    return (
      bankWhenNeeded(state, routes) ??
      specialMove(state, routes) ??
      collect(state, routes) ??
      fallback(state)
    );
  }
}

function bankCost(state: Observation, routes: Routes): number {
  const sites = getBankingSites(state);

  return Math.min(...sites.map((site) => routes.get(positionKey(site))?.cost ?? Infinity));
}

function bankWhenNeeded(state: Observation, routes: Routes): Action | undefined {
  const bag = getInventoryStats(state);
  const fullEnough = bag.freeWeight < BANK_WHEN_FREE_WEIGHT_BELOW;
  const late = state.remainingTicks <= bankCost(state, routes) + HOME_MARGIN;
  const hasCargo = bag.weight > 0;
  if (hasCargo && (fullEnough || late)) return { type: "home" };

  return undefined;
}

function specialMove(_state: Observation, _routes: Routes): Action | undefined {
  return undefined; // The team's twist goes here; drop the underscores once the params are used.
}

function collect(state: Observation, routes: Routes): Action | undefined {
  if (canGrab(state)) return { type: "grab" };
  const direction = closestPileRoute(state, routes)?.steps[0];

  return direction ? { type: "move", direction } : undefined;
}

function closestPileRoute(state: Observation, routes: Routes): Route | undefined {
  const freeWeight = getInventoryStats(state).freeWeight;
  let best: Route | undefined;
  for (const pile of state.resources) {
    const route = routes.get(positionKey(pile));
    const fits = RESOURCES[pile.kind].weight <= freeWeight;
    if (!route || !fits) continue;
    const closer = route.cost < (best?.cost ?? Infinity);
    if (closer) best = route;
  }

  return best;
}

function fallback(state: Observation): Action {
  return getInventoryStats(state).weight > 0 ? { type: "home" } : { type: "skip" };
}
```

Put the team's settings in named constants at the top so a practice version changes one line. The team speaks in relative terms ("bank when mostly full"); you pick the number and record both in BUILD.md.

## Measured lessons

From dev `bench` runs against `nearest` (seed `dev`, all biomes):

- Adding `getDefensiveAction(state)` as the first step cut a bot from 84 to 48. It is safe but very cautious; use it only for the specific danger the design names, and bench it.
- Ranking piles by value per distance (`value / (cost + 1)`) scored 49 to 71 versus 112 for closest-first: it walks into contested hotspots and guardians. A value twist needs a guard against that, for example only near the bot's route home.
- Banking at any owned bank with a small margin beat `nearest`'s base-only, full-bag banking.

## Speed: 100 ms per decision

- One `distanceField` from the bot per turn; reuse it for every lookup.
- `planTrip` runs two searches: call it for at most about 3 shortlisted targets.
- No loops over every tile times every pile. No `await` tricks; the deadline still applies.

## Bugs that cost points

- Cargo scores only when banked. Always bank before the end: compare `remainingTicks` with the bank route cost plus a margin.
- Weight is not unit count: use `getInventoryStats(state).freeWeight`.
- Use `state.self.id` for ownership, not `metadata.id`; copies get `-copy-N` IDs.
- A move into blocked terrain, an empty `grab`, or an ineligible action wastes the turn; invalid actions count as errors. Check with `canGrab`, `canCapture`, `canSteal`, `canStrike`, `canLootCache`, `canDeployTrap` first.
- `home` moves one step; return it again every turn.
- Class fields persist within one match only. No clocks, files, or network.

## Practice versions

Copy the final bot, change one decision or number, and give it a new `id`, `name`, and `description`. Good practice versions settle a real question from DESIGN.md or a setting the team could not choose: a different bank threshold, a bolder special move, or leaving danger earlier. Report the result in plain words ("banking earlier scored about 10% more"). If a practice version wins and the intent owner agrees, copy its logic back into `bots/<id>.ts`, keep `id: "<id>"`, and rerun `check` and `bench`.

## Practice rivals

Small, distinct rivals that mimic what other teams may bring. About 30 to 60 lines each, built from SDK helpers:

| Archetype    | Core of `act`                                                                               |
| ------------ | ------------------------------------------------------------------------------------------- |
| thief        | `getStealTargets(state)[0]` → `steal`; otherwise walk toward the rival with the most cargo. |
| trapper      | `getTrapAction(state)` first, then collect ore like `nearest`.                              |
| brawler      | `getCompetitiveAction(state)` first (sabotage, cache combat, loot, traps), then collect.    |
| outposter    | Walk to the nearest outpost it does not own, `capture` while `canCapture`, then collect.    |
| relic hunter | Collect only crystals and relics, bank when full or late.                                   |

Pick the archetypes that attack the team's plan, for example a thief against a bot that carries a full bag far from base.
