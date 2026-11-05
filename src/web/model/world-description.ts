import { samePosition } from "../../engine/pathfinding.ts";
import { guardianPosition } from "../../engine/world/types.ts";
import type { Position, Snapshot } from "../../engine/types.ts";

export function describeWorldCell(state: Snapshot, position: Position): string {
  const details: string[] = [];
  const drone = state.world.drones.find((enemy) => samePosition(enemy.position, position));
  const cache = state.world.caches.find((site) => samePosition(site.position, position));
  const guardian = findGuardianAt(state, position);
  if (guardian) details.push(`${guardian.id} guardian · HP ${guardian.guardianHealth}/3`);
  const trap = state.world.traps.find((site) => samePosition(site, position));
  const outpost = state.outposts.find((site) => samePosition(site, position));
  if (drone) details.push(`${drone.id} · HP ${drone.health}/2`);
  if (cache) details.push(`${cache.id} · ${cache.inventory.length} items`);
  if (trap)
    details.push(`${trap.ownerId}'s trap · arms T${trap.armedAt} · expires T${trap.expiresAt}`);
  if ((outpost?.disabledUntilTick ?? 0) > state.tick)
    details.push(`Bank offline until T${outpost!.disabledUntilTick}`);
  if ((outpost?.captureProtectedUntilTick ?? 0) > state.tick)
    details.push(`Ownership protected until T${outpost!.captureProtectedUntilTick}`);
  if ((outpost?.sabotageProtectedUntilTick ?? 0) > state.tick)
    details.push(`Sabotage protected until T${outpost!.sabotageProtectedUntilTick}`);
  if (outpost?.sabotageProgress) details.push(`Sabotage ${outpost.sabotageProgress}/2`);

  for (const hazard of state.world.hazards) {
    if (!hazard.cells.some((cell) => samePosition(cell, position))) continue;

    details.push(`${hazard.kind} · impact T${hazard.startsAt} · clears T${hazard.endsAt}`);
  }

  return details.length ? ` · ${details.join(" · ")}` : "";
}

function findGuardianAt(state: Snapshot, position: Position) {
  return state.world.caches.find((site) => {
    const alive = site.guardianHealth > 0;
    const sharesCell = samePosition(guardianPosition(site), position);

    return alive && sharesCell;
  });
}
