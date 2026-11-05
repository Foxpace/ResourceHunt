import { createMatchStatistics, type MatchStatistics } from "./match-statistics.ts";
import { WorldController } from "./world/world-controller.ts";
import { getHazardMap } from "./world/hazard-map.ts";
import type { WorldContext, VisualEffect } from "./world/types.ts";
import { MAX_BOTS } from "./types.ts";
import { generateMap } from "./map.ts";
import { normalizeConfig } from "./config.ts";
import {
  getNearestBank,
  isBankingTile,
  isContested,
  isOutpostProtected,
  stealableItem,
} from "./competition.ts";
import {
  DIRECTIONS,
  inventoryValue,
  inventoryWeight,
  samePosition,
  terrainCost,
} from "./pathfinding.ts";
import {
  BOT_COLORS,
  RESOURCES,
  type Action,
  type BotController,
  type BotState,
  type Frame,
  type Direction,
  type Observation,
  type Position,
  type GameConfig,
  type GameEvent,
  type GameMap,
  type MatchResult,
  type Replay,
  type ResourcePile,
  type Snapshot,
  type Hotspot,
  type Outpost,
  THEFT_PROTECTION_TICKS,
} from "./types.ts";

export class Game {
  readonly config: GameConfig;
  private map: GameMap;
  private resources: ResourcePile[];
  private bots: BotState[];
  private hotspots: Hotspot[];
  private outposts: Outpost[];
  private tick = 0;
  private readonly statistics = new Map<string, MatchStatistics>();
  private events: GameEvent[] = [];
  private frames: Frame[] = [];
  private initial: Snapshot;
  private world: WorldController;
  private stepping = false;
  private closed = false;

  constructor(
    private controllers: BotController[],
    config: Partial<GameConfig> = {},
    private options: { recordReplay?: boolean } = {},
  ) {
    const invalidBotCount = controllers.length < 1 || controllers.length > MAX_BOTS;
    if (invalidBotCount) throw new Error(`Select between 1 and ${MAX_BOTS} bots`);
    if (new Set(controllers.map((bot) => bot.metadata.id)).size !== controllers.length)
      throw new Error("Bot IDs must be unique");

    this.config = normalizeConfig(config);
    const generated = generateMap(this.config, controllers.length);
    this.map = generated.map;
    this.resources = generated.resources;
    this.hotspots = generated.hotspots;
    this.outposts = generated.outposts;
    this.bots = controllers.map((controller, index) =>
      this.createBotState(controller, generated.bases[index]!, index),
    );
    for (const bot of this.bots) this.statistics.set(bot.id, createMatchStatistics());
    this.world = new WorldController(this.createWorldContext());
    this.initial = this.snapshot();
  }

  private createBotState(controller: BotController, base: Position, index: number): BotState {
    return {
      ...controller.metadata,
      color: BOT_COLORS[index]!,
      position: { ...base },
      base: { ...base },
      inventory: [],
      score: 0,
      delivered: 0,
      travelRemaining: 0,
      errors: 0,
      lastAction: "Ready",
      disabled: false,
      stealReadyTick: 0,
      theftProtectedUntilTick: 0,
      captures: 0,
      stolen: 0,
      lost: 0,
    };
  }

  snapshot(): Snapshot {
    return structuredClone({
      config: this.config,
      map: this.createCurrentMap(),
      ...this.createCurrentFrame(),
    });
  }

  private createCurrentFrame(): Frame {
    return {
      statistics: Object.fromEntries(this.statistics),
      world: this.world.state,
      tick: this.tick,
      bots: this.bots,
      resources: this.resources,
      hotspots: this.hotspots,
      outposts: this.outposts,
      events: this.events,
      finished: this.tick >= this.config.ticks,
    };
  }

  async step(): Promise<Snapshot> {
    if (this.stepping) throw new Error("A tick is already in progress");
    if (this.tick >= this.config.ticks) return this.snapshot();
    if (this.closed) throw new Error("Game has been disposed");

    this.stepping = true;
    this.events = [];
    try {
      this.world.prepareTick(this.createWorldContext());
      // Rotating initiative avoids giving the same bot first access every tick.
      for (let offset = 0; offset < this.bots.length; offset++) {
        const index = (this.tick + offset) % this.bots.length;
        await this.takeBotTurn(index);
      }

      this.world.finishTick(this.createWorldContext());
      this.countDepotDowntime();
      this.tick++;
      if (this.options.recordReplay !== false)
        this.frames.push(structuredClone(this.createCurrentFrame()));
      if (this.tick >= this.config.ticks) this.dispose();

      return this.snapshot();
    } finally {
      this.stepping = false;
    }
  }

  private async takeBotTurn(index: number): Promise<void> {
    const bot = this.bots[index]!;
    if (bot.disabled) {
      this.resetBotCapture(bot.id);
      return;
    }
    if (bot.travelRemaining > 0) {
      bot.travelRemaining--;
      this.resetBotCapture(bot.id);
      bot.lastAction = `Crossing terrain · ${bot.travelRemaining} remaining`;
      return;
    }

    await this.requestBotDecision(index, bot);
  }

  private createBotObservation(bot: BotState): Observation {
    return structuredClone({
      config: this.config,
      tick: this.tick,
      maxTicks: this.config.ticks,
      remainingTicks: this.config.ticks - this.tick,
      capacity: this.config.capacity,
      map: this.createCurrentMap(),
      world: this.world.state,
      resources: this.resources,
      hotspots: this.hotspots,
      outposts: this.outposts,
      bots: this.bots,
      self: bot,
    });
  }

  private async requestBotDecision(index: number, bot: BotState): Promise<void> {
    try {
      const decision = await this.controllers[index]!.decide(this.createBotObservation(bot));
      if (decision.error) {
        this.resetBotCapture(bot.id);
        bot.disabled = decision.disabled ?? false;
        this.recordBotError(bot, decision.error);
      } else if (!isValidBotAction(decision.action)) {
        this.resetBotCapture(bot.id);
        this.recordBotError(
          bot,
          "Invalid action. Use a documented movement, collection, competition, or defense action.",
        );
      } else {
        this.applyBotAction(bot, decision.action);
      }
    } catch (error) {
      this.resetBotCapture(bot.id);
      this.recordBotError(bot, error instanceof Error ? error.message : String(error));
    }
  }

  private recordBotEvent(bot: BotState, kind: GameEvent["kind"], effect?: VisualEffect): void {
    this.events.push({
      tick: this.tick + 1,
      botId: bot.id,
      kind,
      message: bot.lastAction,
      position: { ...bot.position },
      effect: effect ?? (kind === "score" ? "bank" : kind === "error" ? "error" : "collect"),
    });
  }

  private recordBotError(bot: BotState, message: string) {
    bot.errors++;
    bot.lastAction = message.slice(0, 240);
    this.recordBotEvent(bot, "error");
  }

  private applyBotAction(bot: BotState, action: Action): void {
    if (action.type === "sabotage") this.statistics.get(bot.id)!.sabotageAttempts++;
    if (action.type !== "capture") this.resetBotCapture(bot.id);
    if (this.world.applyAction(this.createWorldContext(), { bot, action })) return;

    switch (action.type) {
      case "skip":
        bot.lastAction = "Skipped";
        return;
      case "grab":
        this.grabResource(bot);
        return;
      case "home":
        this.navigateHome(bot);
        return;
      case "move":
        this.moveBot(bot, action.direction, `Moved ${action.direction}`);
        return;
      case "capture":
        this.captureOutpost(bot);
        return;
      case "steal":
        this.stealResourcesFromOtherBot(bot, action.targetId);
    }
  }

  private grabResource(bot: BotState): void {
    const pile = this.resources.find((pile) => samePosition(pile, bot.position));
    if (!pile) {
      bot.lastAction = "No resource here";
      return;
    }
    if (inventoryWeight(bot.inventory) + RESOURCES[pile.kind].weight > this.config.capacity) {
      bot.lastAction = "Bag cannot fit this resource";
      return;
    }

    bot.inventory.push(pile.kind);
    pile.amount--;
    this.statistics.get(bot.id)!.gathered++;
    bot.lastAction = `Grabbed ${pile.kind}`;
    this.recordBotEvent(bot, "action");
    if (!pile.amount) this.resources = this.resources.filter((resource) => resource !== pile);

    this.depositResources(bot);
  }

  private navigateHome(bot: BotState): void {
    if (isBankingTile(bot, this.outposts, this.tick)) {
      bot.lastAction = "At bank";
      this.depositResources(bot);
      return;
    }

    const bank = getNearestBank({
      self: bot,
      map: this.createCurrentMap(),
      outposts: this.outposts,
      tick: this.tick,
    });
    const direction = bank?.route.steps[0];
    if (!direction) {
      bot.lastAction = "Home is unreachable";
      return;
    }

    this.moveBot(bot, direction, "Heading home");
  }

  private moveBot(bot: BotState, direction: Direction, message: string): void {
    const delta = DIRECTIONS[direction];
    const destination = { x: bot.position.x + delta.x, y: bot.position.y + delta.y };
    const cost = terrainCost(this.createCurrentMap(), destination);
    if (!Number.isFinite(cost)) {
      bot.lastAction = "Blocked by river or map edge";
      return;
    }

    this.statistics.get(bot.id)!.tilesWalked++;
    bot.position = destination;
    bot.travelRemaining = cost - 1;

    for (const post of this.outposts) {
      const capturingBotId = post.capturingBotId;

      const captureContested = !!capturingBotId && isContested(post, this.bots, capturingBotId);
      if (captureContested) this.resetBotCapture(capturingBotId);
    }

    bot.lastAction = message;
    this.world.afterMovement(this.createWorldContext(), bot);
    this.depositResources(bot);
  }

  private depositResources(bot: BotState) {
    const cannotDeposit = !isBankingTile(bot, this.outposts, this.tick) || !bot.inventory.length;
    if (cannotDeposit) return;

    const value = inventoryValue(bot.inventory);
    bot.score += value;
    this.statistics.get(bot.id)!.deposits++;
    bot.delivered += bot.inventory.length;
    bot.inventory = [];
    bot.lastAction = `Banked +${value}`;
    this.recordBotEvent(bot, "score");
  }

  private resetBotCapture(botId: string): void {
    for (const post of this.outposts)
      if (post.capturingBotId === botId) {
        post.capturingBotId = null;
        post.captureProgress = 0;
      }
  }

  private captureOutpost(bot: BotState): void {
    const post = this.outposts.find((post) => samePosition(post, bot.position));

    const outpostUnavailable = !post || post.ownerId === bot.id;
    if (outpostUnavailable) {
      this.resetBotCapture(bot.id);
      bot.lastAction = post ? "Outpost already owned" : "No outpost here";
      return;
    }
    if (isOutpostProtected(post, this.tick)) {
      this.resetBotCapture(bot.id);
      bot.lastAction = `Outpost protected until tick ${post.captureProtectedUntilTick}`;
      return;
    }
    if (isContested(post, this.bots, bot.id)) {
      this.resetBotCapture(bot.id);
      bot.lastAction = "Outpost contested";
      return;
    }
    if (post.capturingBotId !== bot.id) {
      post.capturingBotId = bot.id;
      post.captureProgress = 0;
    }

    post.captureProgress++;
    bot.lastAction = `Capturing ${post.id} ${post.captureProgress}/${this.config.captureTurns}`;
    if (post.captureProgress >= this.config.captureTurns) this.completeOutpostCapture(bot, post);
  }

  private completeOutpostCapture(bot: BotState, post: Outpost): void {
    const recaptured = post.ownerId !== null;
    post.ownerId = bot.id;
    post.captureProtectedUntilTick =
      this.config.captureImmunityTicks > 0 ? this.tick + this.config.captureImmunityTicks + 1 : 0;
    bot.captures++;
    this.resetBotCapture(bot.id);
    bot.lastAction = `${recaptured ? "Recaptured" : "Captured"} ${post.id}`;
    this.recordBotEvent(bot, "action", "capture");
    this.depositResources(bot);
  }

  private stealResourcesFromOtherBot(bot: BotState, targetId: string): void {
    const victim = this.bots.find((other) => other.id === targetId);

    const kind =
      victim &&
      stealableItem({ config: this.config, tick: this.tick, bots: this.bots }, bot, victim);
    const theftUnavailable = !victim || !kind;
    if (theftUnavailable) {
      bot.lastAction = "Cannot steal from this bot";
      return;
    }

    victim.inventory.splice(victim.inventory.indexOf(kind), 1);
    bot.inventory.push(kind);
    bot.stolen++;
    this.statistics.get(bot.id)!.stolenValue += RESOURCES[kind].value;
    victim.lost++;
    bot.stealReadyTick = this.tick + this.config.stealCooldownTicks;
    // Both participants get one complete following tick to escape a theft loop.
    bot.theftProtectedUntilTick = this.tick + THEFT_PROTECTION_TICKS;
    victim.theftProtectedUntilTick = this.tick + THEFT_PROTECTION_TICKS;
    bot.lastAction = `Stole ${kind} from ${victim.name}`;
    victim.lastAction = `Lost ${kind} to ${bot.name}`;
    this.recordBotEvent(bot, "action", "steal");
    this.depositResources(bot);
  }

  result(): MatchResult {
    const sorted = [...this.bots].sort(
      (first, second) => second.score - first.score || first.id.localeCompare(second.id),
    );

    return {
      config: { ...this.config },
      botOrder: this.bots.map((bot) => bot.id),
      ticks: this.tick,
      standings: sorted.map((bot) => ({
        rank: sorted.findIndex((other) => other.score === bot.score) + 1,
        id: bot.id,
        name: bot.name,
        score: bot.score,
        delivered: bot.delivered,
        carriedValue: inventoryValue(bot.inventory),
        errors: bot.errors,
        disabled: bot.disabled,
        captures: bot.captures,
        outpostsOwned: this.outposts.filter((post) => post.ownerId === bot.id).length,
        stolen: bot.stolen,
        lost: bot.lost,
        statistics: { ...this.statistics.get(bot.id)! },
      })),
      resourceUnitsLeft: this.countRemainingResources(),
    };
  }

  private countDepotDowntime(): void {
    for (const post of this.outposts) {
      const offline = (post.disabledUntilTick ?? 0) > this.tick;
      const ownerId = post.ownerId;
      if (!offline || !ownerId) continue;

      this.statistics.get(ownerId)!.depotOfflineTicks++;
    }
  }

  private createWorldContext(): WorldContext {
    return {
      tick: this.tick,
      config: this.config,
      map: this.map,
      bots: this.bots,
      resources: this.resources,
      outposts: this.outposts,
      hotspots: this.hotspots,
      events: this.events,
      statistics: this.statistics,
    };
  }

  private createCurrentMap(): GameMap {
    return getHazardMap(this.map, this.world.state, this.tick);
  }

  private countRemainingResources(): number {
    const loose = this.resources.reduce((sum, pile) => sum + pile.amount, 0);
    const cached = this.world.state.caches.reduce((sum, cache) => sum + cache.inventory.length, 0);
    const scavenged = this.world.state.drones.reduce(
      (sum, drone) => sum + drone.inventory.length,
      0,
    );

    return loose + cached + scavenged;
  }

  replay(): Replay {
    return structuredClone({
      version: 1,
      initial: this.initial,
      frames: this.frames,
      result: this.result(),
    });
  }
  dispose() {
    if (!this.closed) {
      this.closed = true;

      for (const controller of this.controllers) controller.dispose();
    }
  }
}

function isValidBotAction(value: unknown): value is Action {
  if (!value) return false;
  if (typeof value !== "object") return false;
  if (!("type" in value)) return false;
  if (value.type === "move") return isValidMoveDirection(value);

  const targetedAction = [
    "steal",
    "sabotage",
    "repair",
    "clearTrap",
    "strike",
    "lootCache",
  ].includes(String(value.type));
  if (targetedAction) return isValidTargetReference(value);
  if (typeof value.type !== "string") return false;

  return ["grab", "skip", "home", "capture", "guard", "deployTrap"].includes(value.type);
}

function isValidMoveDirection(value: object): boolean {
  if (!("direction" in value)) return false;
  if (typeof value.direction !== "string") return false;

  return Object.hasOwn(DIRECTIONS, value.direction);
}

function isValidTargetReference(value: object): boolean {
  if (!("targetId" in value)) return false;
  if (typeof value.targetId !== "string") return false;

  const hasTargetId = value.targetId.length > 0;
  const withinLengthLimit = value.targetId.length <= 48;

  return hasTargetId && withinLengthLimit;
}
