import { randomFromSeed } from "../random.ts";
import type { Position } from "../types.ts";
import type { ScavengerDrone, WorldTurn } from "./types.ts";

const MINIMUM_LEASH = 5;
const LEASH_VARIATION = 8;
const MINIMUM_RETRY_DELAY = 6;
const RETRY_DELAY_VARIATION = 9;

/**
 * Engine-only drone state. It is deliberately kept out of `WorldState`, so bots and replays never
 * learn how far a drone will chase them or when it will try again.
 */
export interface DroneMind {
  home: Position;
  leash: number;
  retryAtTick: number;
  pursuing: boolean;
  random: () => number;
}

export class DroneMinds {
  private minds = new Map<string, DroneMind>();

  mindOf(turn: WorldTurn, drone: ScavengerDrone): DroneMind {
    const existing = this.minds.get(drone.id);
    if (existing) return existing;

    const random = randomFromSeed(`${turn.context.config.seed}:${drone.id}:mind`);
    const mind = {
      home: { ...drone.position },
      leash: rollLeash(random),
      retryAtTick: 0,
      pursuing: false,
      random,
    };
    this.minds.set(drone.id, mind);

    return mind;
  }
}

/** Gives up the chase, waits a random while before trying again, and picks a new leash. */
export function retireDrone(mind: DroneMind, tick: number): void {
  const delay = MINIMUM_RETRY_DELAY + Math.floor(mind.random() * RETRY_DELAY_VARIATION);

  mind.retryAtTick = tick + delay;
  mind.leash = rollLeash(mind.random);
  mind.pursuing = false;
}

function rollLeash(random: () => number): number {
  return MINIMUM_LEASH + Math.floor(random() * LEASH_VARIATION);
}
