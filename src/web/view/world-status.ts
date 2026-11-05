import type { Snapshot } from "../../engine/types.ts";
import type { HazardKind } from "../../engine/world/types.ts";

const HAZARD_LABELS: Record<HazardKind, string> = {
  lava: "Lava surge",
  boulders: "Boulder fall",
  meteors: "Meteor shower",
  storm: "Thunderstorm",
  sandstorm: "Sandstorm",
  squall: "Ocean squall",
  blizzard: "Blizzard",
  wildfire: "Wildfire",
};

export function renderWorldStatus(state: Snapshot): string {
  const hazard = state.world.hazards[0];
  const active = !!hazard && hazard.startsAt <= state.tick;
  const forecast = hazard
    ? `${HAZARD_LABELS[hazard.kind]} · ${active ? `clears in ${hazard.endsAt - state.tick}` : `in ${hazard.startsAt - state.tick}`} ticks`
    : "Clear conditions";
  const drones = state.world.drones.filter((enemy) => enemy.health > 0).length;
  const caches = state.world.caches.filter((cache) => cache.inventory.length > 0).length;
  const offline = state.outposts.filter(
    (outpost) => (outpost.disabledUntilTick ?? 0) > state.tick,
  ).length;

  return `<span class="world-forecast ${active ? "is-active" : ""}"><i class="status-beacon"></i>${forecast}</span>
    <span class="world-count"><b>◈</b> ${drones} drones</span>
    <span class="world-count"><b>⬡</b> ${caches} caches</span>
    <span class="world-count"><b>△</b> ${state.world.traps.length} traps${offline ? ` · ${offline} banks offline` : ""}</span>`;
}
