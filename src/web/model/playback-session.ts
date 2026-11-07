import type { Replay, Snapshot } from "../../engine/types.ts";
import type { CreateGameRequest } from "../../http/types.ts";
import type { GameClient } from "../data/game-client.ts";

type LivePlaybackSource = {
  readonly kind: "live";
  readonly sessionId: string;
  readonly initialSnapshot: Snapshot;
};
type RecordedPlaybackSource = { readonly kind: "recorded" | "stopped"; readonly replay: Replay };
export type SelectedPlaybackSource = LivePlaybackSource | RecordedPlaybackSource;
export type PlaybackSource = { readonly kind: "empty" } | SelectedPlaybackSource;

interface PendingSourceSelection {
  readonly selectionId: number;
  readonly sourceKind: SelectedPlaybackSource["kind"];
}

/** Owns source selection, in-flight requests, and server-session cleanup. */
export class PlaybackSession {
  private activeSource: PlaybackSource = { kind: "empty" };
  private lifecycle: "active" | "disposed" = "active";
  private sourceSelectionSequence = 0;
  private pendingSourceSelection?: PendingSourceSelection;
  private pendingLiveTick?: Promise<Snapshot | undefined>;
  private pendingDisposal?: Promise<void>;

  constructor(
    private gameClient: GameClient,
    private publishSelectedSource: (source: SelectedPlaybackSource) => void,
  ) {}

  get source(): PlaybackSource {
    return this.activeSource;
  }

  get isDisposed(): boolean {
    return this.lifecycle === "disposed";
  }

  get isSelecting(): boolean {
    return this.pendingSourceSelection !== undefined;
  }

  get isCreating(): boolean {
    return this.pendingSourceSelection?.sourceKind === "live";
  }

  get isStopping(): boolean {
    return this.pendingSourceSelection?.sourceKind === "stopped";
  }

  get isBusy(): boolean {
    const sessionOpen = !this.isDisposed;
    const selectingSource = this.isSelecting;
    const tickPending = !!this.pendingLiveTick;

    return sessionOpen && (selectingSource || tickPending);
  }

  createLiveSession(request: CreateGameRequest): Promise<void> {
    return this.requestSourceSelection("live", async () => {
      const session = await this.gameClient.create(request);

      return { kind: "live", sessionId: session.id, initialSnapshot: session.snapshot };
    });
  }

  selectRecordedReplay(replay: Replay): Promise<void> {
    return this.requestSourceSelection("recorded", async () => ({ kind: "recorded", replay }));
  }

  stopLiveSession(): Promise<void> {
    const source = this.activeSource;
    if (source.kind !== "live") return Promise.resolve();

    return this.requestSourceSelection("stopped", async () => ({
      kind: "stopped",
      replay: await this.gameClient.replay(source.sessionId),
    }));
  }

  advanceLiveSession(): Promise<Snapshot | undefined> {
    this.assertSessionIsActive();
    if (this.pendingLiveTick) return this.pendingLiveTick;

    const source = this.activeSource;
    const canAdvance = source.kind === "live" && !this.isSelecting;
    if (!canAdvance) return Promise.resolve(undefined);

    this.pendingLiveTick = this.requestLiveSnapshot(source).finally(() => {
      this.pendingLiveTick = undefined;
    });

    return this.pendingLiveTick;
  }

  async exportActiveReplay(): Promise<Replay> {
    this.assertSessionIsActive();
    const source = this.activeSource;
    await this.pendingLiveTick;
    this.assertExportSourceIsCurrent(source);

    if (source.kind === "empty") throw new Error("Create a match before exporting a replay");
    if (source.kind !== "live") return source.replay;

    const replay = await this.gameClient.replay(source.sessionId);
    this.assertExportSourceIsCurrent(source);

    return replay;
  }

  disposeSession(): Promise<void> {
    if (this.pendingDisposal) return this.pendingDisposal;

    this.lifecycle = "disposed";
    this.sourceSelectionSequence++;
    this.pendingSourceSelection = undefined;
    const retiredSource = this.activeSource;
    this.activeSource = { kind: "empty" };
    this.pendingDisposal = this.releaseSourceAfterPendingTick(retiredSource);

    return this.pendingDisposal;
  }

  private async requestSourceSelection(
    sourceKind: SelectedPlaybackSource["kind"],
    requestSource: () => Promise<SelectedPlaybackSource>,
  ): Promise<void> {
    this.assertSessionIsActive();
    const selectionId = ++this.sourceSelectionSequence;
    this.pendingSourceSelection = { selectionId, sourceKind };

    try {
      // A failed tick must not block a replacement source.
      await this.pendingLiveTick?.catch(() => {});
      if (!this.isLatestSourceSelection(selectionId)) return;

      const source = await requestSource();
      await this.commitSourceSelection(source, selectionId);
    } catch (error) {
      if (this.isLatestSourceSelection(selectionId)) throw error;
    } finally {
      if (this.isLatestSourceSelection(selectionId)) this.pendingSourceSelection = undefined;
    }
  }

  private async commitSourceSelection(
    source: SelectedPlaybackSource,
    selectionId: number,
  ): Promise<void> {
    if (!this.isLatestSourceSelection(selectionId)) {
      await this.releaseLiveSource(source);
      return;
    }

    const retiredSource = this.activeSource;
    this.activeSource = source;
    try {
      this.publishSelectedSource(source);
    } finally {
      await this.releaseLiveSource(retiredSource);
    }
  }

  private async requestLiveSnapshot(source: LivePlaybackSource): Promise<Snapshot | undefined> {
    try {
      const { snapshot } = await this.gameClient.step(source.sessionId);
      return this.isSelectedSource(source) ? snapshot : undefined;
    } catch (error) {
      if (this.isSelectedSource(source)) throw error;
    }
  }

  private async releaseSourceAfterPendingTick(source: PlaybackSource): Promise<void> {
    await this.pendingLiveTick?.catch(() => {});
    await this.releaseLiveSource(source);
  }

  private async releaseLiveSource(source: PlaybackSource): Promise<void> {
    if (source.kind !== "live") return;

    // Expired or disconnected sessions are also reclaimed by the server's idle timeout.
    await this.gameClient.release(source.sessionId).catch(() => {});
  }

  private isLatestSourceSelection(selectionId: number): boolean {
    return !this.isDisposed && selectionId === this.pendingSourceSelection?.selectionId;
  }

  private isSelectedSource(source: PlaybackSource): boolean {
    return !this.isDisposed && this.activeSource === source;
  }

  private assertSessionIsActive(): void {
    if (this.isDisposed) throw new Error("Playback has been disposed");
  }

  private assertExportSourceIsCurrent(source: PlaybackSource): void {
    this.assertSessionIsActive();
    if (source !== this.activeSource) throw new Error("Playback source changed during export");
  }
}
