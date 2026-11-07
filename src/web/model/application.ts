import { minimumMapSize } from "../../engine/map-layout.ts";
import { MAX_BOTS, type BotMetadata, type GameConfig, type Replay } from "../../engine/types.ts";
import { parseReplay } from "../../engine/replay.ts";
import type { BotCatalogResponse, CreateGameRequest } from "../../http/types.ts";
import type { GameClient } from "../data/game-client.ts";
import { Playback } from "./playback.ts";

type CatalogClient = GameClient & { bots(): Promise<BotCatalogResponse> };
export interface ReplayFile {
  readonly size: number;
  text(): Promise<string>;
}

export type ApplicationIntent =
  | { type: "refreshBots"; initial?: boolean }
  | { type: "selectBots"; botIds: string[] }
  | { type: "setBotCopies"; botId: string; copies: number }
  | { type: "generateMatch"; request: CreateGameRequest }
  | { type: "togglePlayback"; getSpeed: () => number }
  | { type: "stepPlayback" }
  | { type: "stopMatch" }
  | { type: "seekPlayback"; tick: number }
  | { type: "importReplay"; file: ReplayFile }
  | { type: "exportReplay"; saveReplay: (replay: Replay) => void }
  | { type: "dismissMessage" };

export interface ApplicationState {
  readonly catalog: readonly BotMetadata[];
  readonly selectedBotIds: readonly string[];
  readonly generating: boolean;
  readonly refreshing: boolean;
  readonly message: string;
  readonly canGenerate: boolean;
}

/** Owns application decisions and publishes state. Views only render and dispatch intents. */
export class ApplicationModel {
  readonly playback: Playback;
  private stateListeners = new Set<() => void>();
  private catalog: BotMetadata[] = [];
  private selectedBotIds: string[] = [];
  private refreshing = false;
  private message = "";
  private latestSourceIntentId = 0;
  private disposed = false;

  constructor(private client: CatalogClient) {
    this.playback = new Playback(client);
    this.playback.subscribe(() => this.notifyStateListeners());
  }

  get state(): ApplicationState {
    const generating = this.playback.isCreating;
    const hasParticipants = this.selectedBotIds.length > 0;
    const withinParticipantLimit = this.selectedBotIds.length <= MAX_BOTS;
    const lineupValid = hasParticipants && withinParticipantLimit;
    const available = !this.disposed && !generating;
    const canGenerate = available && lineupValid;

    return {
      catalog: this.catalog,
      selectedBotIds: this.selectedBotIds,
      generating,
      refreshing: this.refreshing,
      message: this.message,
      canGenerate,
    };
  }

  get playbackControls() {
    const playback = this.playback;
    const snapshot = playback.snapshot;
    const unavailable = this.disposed || playback.isCreating || playback.isStopping;
    const offerReplay = snapshot?.finished || playback.isStopped;
    const matchStatus = playback.isStopping ? "Stopping match…" : "Match stopped";
    const showMatchStatus = playback.isStopping || playback.isStopped;

    return {
      canPlay: playback.canPlay && !unavailable,
      playLabel: playback.isPlaying ? "Pause" : offerReplay ? "Replay" : "Run",
      canStep: playback.canStep && !unavailable,
      canStop: playback.canStop && !unavailable,
      canExport: !!snapshot && !unavailable,
      canSeek: playback.length >= 2 && !unavailable,
      maxTick: snapshot?.config.ticks ?? 0,
      tick: snapshot?.tick ?? 0,
      isReplay: playback.isReplay,
      status: showMatchStatus ? matchStatus : playback.isReplay ? "Replay" : "",
    };
  }

  minimumMapDimension(biome: GameConfig["biome"]): number {
    return minimumMapSize(Math.min(MAX_BOTS, this.selectedBotIds.length), biome);
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};

    this.stateListeners.add(listener);

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  async dispatch(intent: ApplicationIntent): Promise<void> {
    if (this.disposed) return;

    try {
      await this.handleIntent(intent);
    } catch (error) {
      if (!this.disposed) this.message = String(error);
    } finally {
      this.notifyStateListeners();
    }
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.latestSourceIntentId++;
    this.refreshing = false;
    this.stateListeners.clear();

    return this.playback.dispose();
  }

  private async handleIntent(intent: ApplicationIntent): Promise<void> {
    switch (intent.type) {
      case "refreshBots":
        return this.refreshBots(intent.initial);
      case "selectBots":
        this.selectedBotIds = [...intent.botIds];
        return;
      case "setBotCopies":
        return this.setBotCopies(intent);
      case "generateMatch":
        return this.generateMatch(intent.request);
      case "togglePlayback":
        if (!this.playback.isCreating) await this.playback.play(intent.getSpeed);
        return;
      case "stepPlayback":
        return this.playback.step();
      case "stopMatch":
        return this.playback.stop();
      case "seekPlayback":
        return this.playback.seek(intent.tick);
      case "importReplay":
        return this.importReplay(intent.file);
      case "exportReplay":
        return this.exportReplay(intent.saveReplay);
      case "dismissMessage":
        this.message = "";
    }
  }

  private setBotCopies(intent: Extract<ApplicationIntent, { type: "setBotCopies" }>): void {
    const knownBot = this.catalog.some((bot) => bot.id === intent.botId);
    const integerCount = Number.isInteger(intent.copies);
    const validCount = integerCount ? intent.copies >= 0 && intent.copies <= MAX_BOTS : false;
    if (!knownBot || !validCount)
      throw new Error(`Choose between 0 and ${MAX_BOTS} copies of an available bot`);

    const counts = new Map(
      this.catalog.map((bot) => [bot.id, this.selectedBotIds.filter((id) => id === bot.id).length]),
    );
    counts.set(intent.botId, intent.copies);
    this.selectedBotIds = this.catalog.flatMap((bot) =>
      Array<string>(counts.get(bot.id) ?? 0).fill(bot.id),
    );
  }

  private async refreshBots(initial = false): Promise<void> {
    this.refreshing = true;
    this.notifyStateListeners();
    try {
      const catalog = await this.client.bots();
      if (this.disposed) return;

      this.catalog = catalog.bots;
      const selected = initial ? catalog.defaultBotIds : this.selectedBotIds;
      this.selectedBotIds = selected.filter((id) => this.catalog.some((bot) => bot.id === id));
      if (catalog.errors.length)
        this.message = catalog.errors.map((error) => `${error.file}: ${error.error}`).join(" · ");
    } finally {
      if (!this.disposed) this.refreshing = false;
    }
  }

  private async generateMatch(request: CreateGameRequest): Promise<void> {
    if (this.playback.isCreating) return;

    const sourceIntentId = ++this.latestSourceIntentId;
    try {
      await this.playback.create(request);
    } catch (error) {
      if (this.isLatestSourceIntent(sourceIntentId)) throw error;
    }
  }

  private async importReplay(file: ReplayFile): Promise<void> {
    const sourceIntentId = ++this.latestSourceIntentId;
    try {
      const text = await this.readReplayText(file);
      if (!this.isLatestSourceIntent(sourceIntentId)) return;

      const replay = parseReplay(JSON.parse(text));
      await this.playback.load(replay);
    } catch (error) {
      if (this.isLatestSourceIntent(sourceIntentId)) throw error;
    }
  }

  private async exportReplay(saveReplay: (replay: Replay) => void): Promise<void> {
    const sourceIntentId = this.latestSourceIntentId;
    try {
      const replay = await this.playback.export();
      if (!this.isLatestSourceIntent(sourceIntentId)) return;

      saveReplay(replay);
    } catch (error) {
      if (this.isLatestSourceIntent(sourceIntentId)) throw error;
    }
  }

  private isLatestSourceIntent(sourceIntentId: number): boolean {
    return !this.disposed && sourceIntentId === this.latestSourceIntentId;
  }

  private async readReplayText(file: ReplayFile): Promise<string> {
    if (file.size > 50 * 1024 * 1024) throw new Error("Replay must be smaller than 50 MB");

    return file.text();
  }

  private notifyStateListeners(): void {
    if (this.disposed) return;

    for (const listener of this.stateListeners) listener();
  }
}
