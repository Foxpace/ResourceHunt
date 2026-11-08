import {
  guardianPosition,
  type GuardianCache,
  type ScavengerDrone,
} from "../../engine/world/types.ts";
import type { BotState, GameEvent, Position, Snapshot } from "../../engine/types.ts";

export interface MapEffect {
  event: GameEvent;
  progress: number;
}

export interface MapAnimation {
  effects: MapEffect[];
  time: number;
  progress: number;
  effectProgress: number;
  previous?: Snapshot;
}

/** Animation timing is presentation state and never changes recorded game frames. */
export class MapMotion {
  private snapshot?: Snapshot;
  private previous?: Snapshot;
  private changedAt = 0;
  private effects: { event: GameEvent; startedAt: number }[] = [];

  acceptSnapshot(snapshot: Snapshot, now: number): void {
    if (this.snapshot === snapshot) return;

    const consecutive = this.snapshot?.tick === snapshot.tick - 1;
    const sameMatch =
      this.snapshot?.config.seed === snapshot.config.seed &&
      this.snapshot?.config.biome === snapshot.config.biome;
    const continueTimeline = consecutive && sameMatch;
    this.previous = continueTimeline ? this.snapshot : undefined;
    this.recordEffects(snapshot, now, continueTimeline);
    this.snapshot = snapshot;
    this.changedAt = now;
  }

  private recordEffects(snapshot: Snapshot, now: number, continueTimeline: boolean): void {
    const continuingEffects = continueTimeline
      ? this.effects.filter((effect) => now - effect.startedAt < 850)
      : [];
    this.effects = [
      ...continuingEffects,
      ...snapshot.events.map((event) => ({ event, startedAt: now })),
    ].slice(-96);
  }

  animation(now: number, reducedMotion = false): MapAnimation {
    const elapsed = Math.max(0, now - this.changedAt);

    const effects = this.effects
      .map(({ event, startedAt }) => ({ event, progress: Math.max(0, (now - startedAt) / 850) }))
      .filter((effect) => effect.progress < 1);

    return {
      effects: reducedMotion ? [] : effects,
      time: reducedMotion ? 0 : now / 1000,
      progress: reducedMotion ? 1 : Math.min(1, elapsed / 160),
      effectProgress: reducedMotion ? 1 : Math.min(1, elapsed / 850),
      previous: this.previous,
    };
  }
}

export function animatedBotPosition(bot: BotState, animation?: MapAnimation): Position {
  if (!animation) return bot.position;
  const previousBot = animation.previous?.bots.find((candidate) => candidate.id === bot.id);
  if (!previousBot) return bot.position;

  return interpolatePosition(previousBot.position, bot.position, animation.progress);
}

export function animatedDronePosition(drone: ScavengerDrone, animation?: MapAnimation): Position {
  if (!animation) return drone.position;
  const previousDrone = animation.previous?.world.drones.find(
    (candidate) => candidate.id === drone.id,
  );
  if (!previousDrone) return drone.position;

  return interpolatePosition(previousDrone.position, drone.position, animation.progress);
}

export function animatedGuardianPosition(cache: GuardianCache, animation?: MapAnimation): Position {
  const position = guardianPosition(cache);
  if (!animation) return position;
  const previousCache = animation.previous?.world.caches.find(
    (candidate) => candidate.id === cache.id,
  );
  if (!previousCache) return position;

  return interpolatePosition(guardianPosition(previousCache), position, animation.progress);
}

function interpolatePosition(previous: Position, current: Position, progress: number): Position {
  const easedProgress = 1 - Math.pow(1 - progress, 3);

  return {
    x: previous.x + (current.x - previous.x) * easedProgress,
    y: previous.y + (current.y - previous.y) * easedProgress,
  };
}
