import type { GameEvent, Replay, Snapshot } from "../engine/types.ts";
import type { CreateGameRequest } from "../http/types.ts";
import type { GameClient } from "./client.ts";

/** Owns live sessions, recorded history, and playback timing. It does not access the DOM. */
export class Playback {
  private sessionId?: string;
  private history: Snapshot[] = [];
  private imported?: Replay;
  private viewIndex = 0;
  private running = false;
  private runToken = 0;
  private pending?: Promise<void>;
  private listeners = new Set<() => void>();

  constructor(private client: GameClient) {}

  get snapshot() {
    return this.history[this.viewIndex];
  }
  get index() {
    return this.viewIndex;
  }
  get length() {
    return this.history.length;
  }
  get isPlaying() {
    return this.running;
  }
  get isBusy() {
    return !!this.pending;
  }
  get isReplay() {
    return !!this.imported || this.viewIndex < this.history.length - 1;
  }
  get canPlay() {
    return !!this.snapshot && (!!this.sessionId || this.length > 1);
  }
  get canStep() {
    return (
      !!this.snapshot &&
      !this.running &&
      !this.pending &&
      (this.viewIndex < this.length - 1 || (!!this.sessionId && !this.snapshot.finished))
    );
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async create(request: CreateGameRequest): Promise<void> {
    this.pause();
    await this.pending;
    const session = await this.client.create(request);
    await this.releaseSession();
    this.sessionId = session.id;
    this.imported = undefined;
    this.history = [session.snapshot];
    this.viewIndex = 0;
    this.notify();
  }

  async load(replay: Replay): Promise<void> {
    this.pause();
    await this.pending;
    await this.releaseSession();
    this.imported = replay;
    this.history = [
      replay.initial,
      ...replay.frames.map((frame) => ({
        config: replay.initial.config,
        map: replay.initial.map,
        ...frame,
      })),
    ];
    this.viewIndex = 0;
    this.notify();
  }

  async export(): Promise<Replay> {
    this.pause();
    await this.pending;
    if (this.imported) return this.imported;
    if (!this.sessionId) throw new Error("Create a match before exporting a replay");
    return this.client.replay(this.sessionId);
  }

  async seek(index: number): Promise<void> {
    this.pause();
    await this.pending;
    this.viewIndex = Math.max(0, Math.min(this.length - 1, Math.trunc(index)));
    this.notify();
  }

  step(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.advance().finally(() => {
      this.pending = undefined;
      this.notify();
    });
    this.notify();
    return this.pending;
  }

  async play(getSpeed: () => number): Promise<void> {
    if (this.running) {
      this.pause();
      return;
    }
    if (!this.canPlay) return;
    if (this.viewIndex === this.length - 1 && (this.snapshot?.finished || this.imported))
      this.viewIndex = 0;
    this.running = true;
    const token = ++this.runToken;
    this.notify();

    try {
      while (this.running && token === this.runToken) {
        const start = performance.now();
        await this.step();
        const delay = Math.max(0, 1000 / getSpeed() - (performance.now() - start));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      this.pause();
      throw error;
    }
  }

  pause(): void {
    this.running = false;
    this.runToken++;
    this.notify();
  }

  recentEvents(limit = 14): GameEvent[] {
    const events: GameEvent[] = [];
    for (let index = this.viewIndex; index >= 0 && events.length < limit; index--) {
      events.push(
        ...this.history[index]!.events.slice()
          .reverse()
          .slice(0, limit - events.length),
      );
    }
    return events;
  }

  async dispose(): Promise<void> {
    this.pause();
    await this.pending?.catch(() => {});
    await this.releaseSession();
    this.listeners.clear();
  }

  private async advance(): Promise<void> {
    if (this.viewIndex < this.length - 1) {
      this.viewIndex++;
      return;
    }
    if (!this.sessionId || this.snapshot?.finished) {
      this.pause();
      return;
    }
    const { snapshot } = await this.client.step(this.sessionId);
    this.history.push(snapshot);
    this.viewIndex = this.length - 1;
    if (snapshot.finished) this.pause();
  }

  private async releaseSession(): Promise<void> {
    const id = this.sessionId;
    this.sessionId = undefined;
    // Expired or disconnected sessions are also reclaimed by the server's idle timeout.
    if (id) await this.client.release(id).catch(() => {});
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
