import type { GameEvent, Replay, Snapshot } from "../../engine/types.ts";
import type { CreateGameRequest } from "../../http/types.ts";
import type { GameClient } from "../data/game-client.ts";
import { PlaybackSession, type SelectedPlaybackSource } from "./playback-session.ts";
import { PlaybackTimeline } from "./playback-timeline.ts";

/** Coordinates playback timing and publishes changes without accessing the DOM. */
export class Playback {
  private playbackSession: PlaybackSession;
  private playbackTimeline = new PlaybackTimeline();
  private isPlaybackRunning = false;
  private playbackRunId = 0;
  private pendingPlaybackStep?: Promise<void>;
  private stateListeners = new Set<() => void>();

  constructor(gameClient: GameClient) {
    this.playbackSession = new PlaybackSession(gameClient, (source) =>
      this.resetTimelineForSource(source),
    );
  }

  get snapshot(): Snapshot | undefined {
    return this.playbackTimeline.snapshot;
  }

  get finalSnapshot(): Snapshot | undefined {
    return this.playbackTimeline.finalSnapshot;
  }

  get index(): number {
    return this.playbackTimeline.index;
  }

  get length(): number {
    return this.playbackTimeline.length;
  }

  get isPlaying(): boolean {
    return this.isPlaybackRunning;
  }

  get isBusy(): boolean {
    return (
      !this.playbackSession.isDisposed &&
      (this.playbackSession.isBusy || !!this.pendingPlaybackStep)
    );
  }

  get isCreating(): boolean {
    return this.playbackSession.isCreating;
  }

  get isReplay(): boolean {
    const source = this.playbackSession.source.kind;
    return source === "recorded" || source === "stopped" || this.playbackTimeline.hasNextFrame;
  }

  get isStopping(): boolean {
    return this.playbackSession.isStopping;
  }

  get isStopped(): boolean {
    return this.playbackSession.source.kind === "stopped" && !this.finalSnapshot;
  }

  get canStop(): boolean {
    const live = this.playbackSession.source.kind === "live";
    const finished = !!this.finalSnapshot;
    const selecting = this.playbackSession.isSelecting;
    return live && !finished && !selecting;
  }

  get canPlay(): boolean {
    const hasPlayableSource = this.playbackSession.source.kind === "live" || this.length > 1;
    const isSourceUnavailable = this.playbackSession.isDisposed || this.playbackSession.isSelecting;

    return !!this.snapshot && hasPlayableSource && !isSourceUnavailable;
  }

  get canStep(): boolean {
    const hasSnapshot = !!this.snapshot;
    const playbackStopped = !this.isPlaybackRunning;
    const sourceAvailable = !this.isBusy;
    const isReadyToStep = hasSnapshot && playbackStopped && sourceAvailable;
    const hasAvailableLiveTick =
      this.playbackSession.source.kind === "live" && !this.snapshot?.finished;
    const hasAvailablePlaybackFrame = this.playbackTimeline.hasNextFrame || hasAvailableLiveTick;

    return !this.playbackSession.isDisposed && isReadyToStep && hasAvailablePlaybackFrame;
  }

  subscribe(listener: () => void): () => void {
    if (this.playbackSession.isDisposed) return () => {};

    this.stateListeners.add(listener);

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  create(request: CreateGameRequest): Promise<void> {
    return this.pauseAndSelectSource(() => this.playbackSession.createLiveSession(request));
  }

  load(replay: Replay): Promise<void> {
    return this.pauseAndSelectSource(() => this.playbackSession.selectRecordedReplay(replay));
  }

  stop(): Promise<void> {
    if (!this.canStop) return Promise.resolve();

    return this.pauseAndSelectSource(() => this.playbackSession.stopLiveSession());
  }

  async export(): Promise<Replay> {
    this.pause();
    await this.pendingPlaybackStep;

    return this.playbackSession.exportActiveReplay();
  }

  async seek(index: number): Promise<void> {
    const expectedSource = this.playbackSession.source;
    this.pause();
    await this.pendingPlaybackStep;

    const isSelectedSourceUnchanged = expectedSource === this.playbackSession.source;
    const canSeek =
      isSelectedSourceUnchanged &&
      !this.playbackSession.isDisposed &&
      !this.playbackSession.isSelecting;
    if (!canSeek) return;

    this.playbackTimeline.seekRecordedFrame(index);
    this.notifyStateListeners();
  }

  step(): Promise<void> {
    if (this.playbackSession.isDisposed) return Promise.resolve();
    if (this.pendingPlaybackStep) return this.pendingPlaybackStep;

    this.pendingPlaybackStep = this.advancePlaybackFrame().finally(() => {
      this.pendingPlaybackStep = undefined;
      this.notifyStateListeners();
    });
    this.notifyStateListeners();

    return this.pendingPlaybackStep;
  }

  async play(getTicksPerSecond: () => number): Promise<void> {
    if (this.isPlaybackRunning) {
      this.pause();
      return;
    }
    if (!this.canPlay) return;

    const restartPlayback =
      !this.playbackTimeline.hasNextFrame && (this.snapshot?.finished || this.isReplay);
    if (restartPlayback) this.playbackTimeline.seekRecordedFrame(0);

    this.isPlaybackRunning = true;
    const runId = ++this.playbackRunId;
    this.notifyStateListeners();

    try {
      await this.runPlaybackLoop(runId, getTicksPerSecond);
    } catch (error) {
      if (!this.isActivePlaybackRun(runId)) return;

      this.pause();
      throw error;
    }
  }

  pause(): void {
    this.invalidatePlaybackRun();
    this.notifyStateListeners();
  }

  recentEvents(limit = 14): GameEvent[] {
    return this.playbackTimeline.getRecentEvents(limit);
  }

  dispose(): Promise<void> {
    this.invalidatePlaybackRun();
    this.stateListeners.clear();

    return this.playbackSession.disposeSession();
  }

  private async pauseAndSelectSource(requestSelection: () => Promise<void>): Promise<void> {
    const pendingSelection = requestSelection();
    this.pause();

    try {
      await pendingSelection;
    } finally {
      this.notifyStateListeners();
    }
  }

  private resetTimelineForSource(source: SelectedPlaybackSource): void {
    if (source.kind === "live")
      this.playbackTimeline.resetToInitialSnapshot(source.initialSnapshot);
    else if (source.kind === "recorded") this.playbackTimeline.loadRecordedReplay(source.replay);

    this.notifyStateListeners();
  }

  private async advancePlaybackFrame(): Promise<void> {
    const isSourceUnavailable = this.playbackSession.isDisposed || this.playbackSession.isSelecting;
    if (isSourceUnavailable) return;
    if (this.playbackTimeline.advanceRecordedFrame()) return;

    const cannotAdvanceLiveMatch =
      this.playbackSession.source.kind !== "live" || !!this.snapshot?.finished;
    if (cannotAdvanceLiveMatch) {
      this.pause();
      return;
    }

    const expectedSource = this.playbackSession.source;
    const snapshot = await this.playbackSession.advanceLiveSession();
    const isSelectedSourceUnchanged =
      !this.playbackSession.isDisposed && expectedSource === this.playbackSession.source;
    if (!isSelectedSourceUnchanged) return;
    if (!snapshot) return;

    this.playbackTimeline.appendLiveSnapshot(snapshot);
    if (snapshot.finished) this.pause();
  }

  private async runPlaybackLoop(runId: number, getTicksPerSecond: () => number): Promise<void> {
    while (this.isActivePlaybackRun(runId)) {
      const tickStartedAt = performance.now();
      await this.step();
      if (!this.isActivePlaybackRun(runId)) return;

      const playbackDelayMs = Math.max(
        0,
        1000 / getTicksPerSecond() - (performance.now() - tickStartedAt),
      );
      await new Promise((resolve) => setTimeout(resolve, playbackDelayMs));
    }
  }

  private isActivePlaybackRun(runId: number): boolean {
    const sessionOpen = !this.playbackSession.isDisposed;
    const running = this.isPlaybackRunning;
    const isCurrentRun = runId === this.playbackRunId;

    return sessionOpen && running && isCurrentRun;
  }

  private invalidatePlaybackRun(): void {
    this.isPlaybackRunning = false;
    this.playbackRunId++;
  }

  private notifyStateListeners(): void {
    if (this.playbackSession.isDisposed) return;

    for (const listener of this.stateListeners) listener();
  }
}
