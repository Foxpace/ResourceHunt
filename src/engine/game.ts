import { MAX_BOTS } from "./types.ts";
import { generateMap } from "./map.ts";
import { normalizeConfig } from "./config.ts";
import { getNearestBank, isBankingTile, isContested, stealableItem } from "./competition.ts";
import { DIRECTIONS, inventoryWeight, samePosition, terrainCost } from "./pathfinding.ts";
import {
  BOT_COLORS,
  RESOURCES,
  type Action,
  type BotController,
  type BotState,
  type Frame,
  type Direction,
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
  private events: GameEvent[] = [];
  private frames: Frame[] = [];
  private initial: Snapshot;
  private stepping = false;
  private closed = false;

  constructor(
    private controllers: BotController[],
    config: Partial<GameConfig> = {},
    private options: { recordReplay?: boolean } = {},
  ) {
    if (controllers.length < 1 || controllers.length > MAX_BOTS)
      throw new Error(`Select between 1 and ${MAX_BOTS} bots`);
    if (new Set(controllers.map((bot) => bot.metadata.id)).size !== controllers.length)
      throw new Error("Bot IDs must be unique");
    this.config = normalizeConfig(config);
    const generated = generateMap(this.config, controllers.length);
    this.map = generated.map;
    this.resources = generated.resources;
    this.hotspots = generated.hotspots;
    this.outposts = generated.outposts;
    this.bots = controllers.map((controller, i) => ({
      ...controller.metadata,
      color: BOT_COLORS[i]!,
      position: { ...generated.bases[i]! },
      base: { ...generated.bases[i]! },
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
    }));
    this.initial = this.snapshot();
  }

  snapshot(): Snapshot {
    return structuredClone({ config: this.config, map: this.map, ...this.frame() });
  }

  private frame(): Frame {
    return {
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
      // Rotating initiative avoids giving the same bot first access every tick.
      for (let offset = 0; offset < this.bots.length; offset++) {
        const i = (this.tick + offset) % this.bots.length;
        await this.takeTurn(i);
      }
      this.tick++;
      if (this.options.recordReplay !== false) this.frames.push(structuredClone(this.frame()));
      if (this.tick >= this.config.ticks) this.dispose();
      return this.snapshot();
    } finally {
      this.stepping = false;
    }
  }

  private async takeTurn(index: number): Promise<void> {
    const bot = this.bots[index]!;
    if (bot.disabled) {
      this.resetCapture(bot.id);
      return;
    }
    if (bot.travelRemaining > 0) {
      bot.travelRemaining--;
      this.resetCapture(bot.id);
      bot.lastAction = `Crossing terrain · ${bot.travelRemaining} remaining`;
      return;
    }
    const observation = structuredClone({
      config: this.config,
      tick: this.tick,
      maxTicks: this.config.ticks,
      remainingTicks: this.config.ticks - this.tick,
      capacity: this.config.capacity,
      map: this.map,
      resources: this.resources,
      hotspots: this.hotspots,
      outposts: this.outposts,
      bots: this.bots,
      self: bot,
    });
    try {
      const decision = await this.controllers[index]!.decide(observation);
      if (decision.error) {
        this.resetCapture(bot.id);
        bot.disabled = decision.disabled ?? false;
        this.error(bot, decision.error);
      } else if (!isAction(decision.action)) {
        this.resetCapture(bot.id);
        this.error(bot, "Invalid action. Use move, grab, skip, home, capture, or steal.");
      } else {
        this.apply(bot, decision.action);
      }
    } catch (error) {
      this.resetCapture(bot.id);
      this.error(bot, error instanceof Error ? error.message : String(error));
    }
  }

  private error(bot: BotState, message: string) {
    bot.errors++;
    bot.lastAction = message.slice(0, 240);
    this.events.push({
      tick: this.tick + 1,
      botId: bot.id,
      kind: "error",
      message: bot.lastAction,
    });
  }

  private apply(bot: BotState, action: Action): void {
    if (action.type !== "capture") this.resetCapture(bot.id);
    switch (action.type) {
      case "skip":
        bot.lastAction = "Skipped";
        return;
      case "grab":
        this.grab(bot);
        return;
      case "home":
        this.navigateHome(bot);
        return;
      case "move":
        this.move(bot, action.direction, `Moved ${action.direction}`);
        return;
      case "capture":
        this.capture(bot);
        return;
      case "steal":
        this.steal(bot, action.targetId);
    }
  }

  private grab(bot: BotState): void {
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
    bot.lastAction = `Grabbed ${pile.kind}`;
    this.events.push({
      tick: this.tick + 1,
      botId: bot.id,
      kind: "action",
      message: bot.lastAction,
    });
    if (!pile.amount) this.resources = this.resources.filter((resource) => resource !== pile);
    this.deposit(bot);
  }

  private navigateHome(bot: BotState): void {
    if (isBankingTile(bot, this.outposts)) {
      bot.lastAction = "At bank";
      this.deposit(bot);
      return;
    }
    const bank = getNearestBank({ self: bot, map: this.map, outposts: this.outposts });
    const direction = bank?.route.steps[0];
    if (!direction) {
      bot.lastAction = "Home is unreachable";
      return;
    }
    this.move(bot, direction, "Heading home");
  }

  private move(bot: BotState, direction: Direction, message: string): void {
    const delta = DIRECTIONS[direction];
    const destination = { x: bot.position.x + delta.x, y: bot.position.y + delta.y };
    const cost = terrainCost(this.map, destination);
    if (!Number.isFinite(cost)) {
      bot.lastAction = "Blocked by river or map edge";
      return;
    }
    bot.position = destination;
    bot.travelRemaining = cost - 1;
    for (const post of this.outposts)
      if (post.capturingBotId && isContested(post, this.bots, post.capturingBotId))
        this.resetCapture(post.capturingBotId);
    bot.lastAction = message;
    this.deposit(bot);
  }

  private deposit(bot: BotState) {
    if (!isBankingTile(bot, this.outposts) || !bot.inventory.length) return;
    const value = bot.inventory.reduce((sum, kind) => sum + RESOURCES[kind].value, 0);
    bot.score += value;
    bot.delivered += bot.inventory.length;
    bot.inventory = [];
    bot.lastAction = `Banked +${value}`;
    this.events.push({
      tick: this.tick + 1,
      botId: bot.id,
      kind: "score",
      message: bot.lastAction,
    });
  }

  private resetCapture(botId: string): void {
    for (const post of this.outposts)
      if (post.capturingBotId === botId) {
        post.capturingBotId = null;
        post.captureProgress = 0;
      }
  }

  private capture(bot: BotState): void {
    const post = this.outposts.find((post) => samePosition(post, bot.position));
    if (!post || post.ownerId === bot.id) {
      this.resetCapture(bot.id);
      bot.lastAction = post ? "Outpost already owned" : "No outpost here";
      return;
    }
    if (isContested(post, this.bots, bot.id)) {
      this.resetCapture(bot.id);
      bot.lastAction = "Outpost contested";
      return;
    }
    if (post.capturingBotId !== bot.id) {
      post.capturingBotId = bot.id;
      post.captureProgress = 0;
    }
    post.captureProgress++;
    bot.lastAction = `Capturing ${post.id} ${post.captureProgress}/${this.config.captureTurns}`;
    if (post.captureProgress >= this.config.captureTurns) {
      post.ownerId = bot.id;
      bot.captures++;
      this.resetCapture(bot.id);
      bot.lastAction = `Captured ${post.id}`;
      this.events.push({
        tick: this.tick + 1,
        botId: bot.id,
        kind: "action",
        message: bot.lastAction,
      });
      this.deposit(bot);
    }
  }

  private steal(bot: BotState, targetId: string): void {
    const victim = this.bots.find((other) => other.id === targetId);
    const kind = victim && stealableItem(this.config, this.tick, this.bots, bot, victim);
    if (!victim || !kind) {
      bot.lastAction = "Cannot steal from this bot";
      return;
    }
    victim.inventory.splice(victim.inventory.indexOf(kind), 1);
    bot.inventory.push(kind);
    bot.stolen++;
    victim.lost++;
    bot.stealReadyTick = this.tick + this.config.stealCooldownTicks;
    // Both participants get one complete following tick to escape a theft loop.
    bot.theftProtectedUntilTick = this.tick + THEFT_PROTECTION_TICKS;
    victim.theftProtectedUntilTick = this.tick + THEFT_PROTECTION_TICKS;
    bot.lastAction = `Stole ${kind} from ${victim.name}`;
    victim.lastAction = `Lost ${kind} to ${bot.name}`;
    this.events.push({
      tick: this.tick + 1,
      botId: bot.id,
      kind: "action",
      message: bot.lastAction,
    });
    this.deposit(bot);
  }

  result(): MatchResult {
    const sorted = [...this.bots].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
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
        carriedValue: bot.inventory.reduce((sum, kind) => sum + RESOURCES[kind].value, 0),
        errors: bot.errors,
        disabled: bot.disabled,
        captures: bot.captures,
        outpostsOwned: this.outposts.filter((post) => post.ownerId === bot.id).length,
        stolen: bot.stolen,
        lost: bot.lost,
      })),
      resourceUnitsLeft: this.resources.reduce((sum, pile) => sum + pile.amount, 0),
    };
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

function isAction(value: unknown): value is Action {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  if (value.type === "move")
    return (
      "direction" in value &&
      typeof value.direction === "string" &&
      Object.hasOwn(DIRECTIONS, value.direction)
    );
  if (value.type === "steal")
    return (
      "targetId" in value &&
      typeof value.targetId === "string" &&
      value.targetId.length > 0 &&
      value.targetId.length <= 48
    );
  return (
    value.type === "grab" ||
    value.type === "skip" ||
    value.type === "home" ||
    value.type === "capture"
  );
}
