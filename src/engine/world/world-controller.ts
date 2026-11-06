import type { BotState } from "../types.ts";
import { createWorldState } from "./generation.ts";
import { sabotageDepot, repairDepot } from "./depot-sabotage.ts";
import { deployCargoTrap, triggerCargoTrap, clearCargoTrap } from "./cargo-traps.ts";
import { DroneMinds } from "./drone-minds.ts";
import { advanceScavengerDrones, expireStolenDroneCargo } from "./scavenger-drones.ts";
import { advanceCacheGuardians } from "./guardian-defense.ts";
import { strikeNeutralEnemy, lootGuardianCache } from "./guardian-caches.ts";
import { NaturalEventScheduler } from "./natural-events.ts";
import { recordWorldAction } from "./shared.ts";
import type { WorldCommand, WorldContext, WorldState, WorldTurn } from "./types.ts";

export class WorldController {
  readonly state: WorldState;
  private weather: NaturalEventScheduler;
  private droneMinds = new DroneMinds();

  constructor(context: WorldContext) {
    this.state = createWorldState(context);
    this.weather = new NaturalEventScheduler(context.config.seed);
    this.weather.initialize({ context, state: this.state });
  }

  prepareTick(context: WorldContext): void {
    this.state.traps = this.state.traps.filter((trap) => trap.expiresAt > context.tick);
    const turn = { context, state: this.state };
    expireStolenDroneCargo(turn);
    this.weather.advance(turn);
    for (const bot of context.bots) triggerCargoTrap(turn, bot);
  }

  finishTick(context: WorldContext): void {
    const turn = { context, state: this.state };
    advanceScavengerDrones(turn, this.droneMinds);
    advanceCacheGuardians(turn);
  }

  afterMovement(context: WorldContext, bot: BotState): void {
    triggerCargoTrap({ context, state: this.state }, bot);
  }

  applyAction(context: WorldContext, command: WorldCommand): boolean {
    const turn = { context, state: this.state };
    const { bot, action } = command;

    const handlers: Partial<Record<typeof action.type, () => void>> = {
      sabotage: () => sabotageDepot(turn, command),
      repair: () => repairDepot(turn, command),
      deployTrap: () => deployCargoTrap(turn, bot),
      clearTrap: () => clearCargoTrap(turn, command),
      strike: () => strikeNeutralEnemy(turn, command),
      lootCache: () => lootGuardianCache(turn, command),
      guard: () => guardBot(turn, bot),
    };
    const handleAction = handlers[action.type];
    handleAction?.();

    return !!handleAction;
  }
}

function guardBot(turn: WorldTurn, bot: BotState): void {
  const defense = turn.state.defenses.find((entry) => entry.botId === bot.id)!;
  defense.guardedUntilTick = turn.context.tick + 2;
  bot.theftProtectedUntilTick = Math.max(bot.theftProtectedUntilTick, turn.context.tick + 2);
  bot.lastAction = "Guarding cargo through the following tick";
  recordWorldAction(turn, bot, "guard");
}
