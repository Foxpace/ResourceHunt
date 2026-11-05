import type { GameEvent } from "../../src/engine/types.ts";

export function createGameEvent(overrides: Partial<GameEvent> = {}): GameEvent {
  return {
    tick: 1,
    botId: "test",
    kind: "score",
    message: "Banked +7",
    effect: "bank",
    position: { x: 1, y: 1 },
    ...overrides,
  };
}
