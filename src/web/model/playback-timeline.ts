import { getHazardMap } from "../../engine/world/hazard-map.ts";
import type { GameEvent, Replay, Snapshot } from "../../engine/types.ts";

/** Recorded frames and cursor navigation, independent of sessions and playback timing. */
export class PlaybackTimeline {
  private recordedSnapshots: Snapshot[] = [];
  private currentFrameIndex = 0;

  get snapshot(): Snapshot | undefined {
    return this.recordedSnapshots[this.currentFrameIndex];
  }

  get finalSnapshot(): Snapshot | undefined {
    const latest = this.recordedSnapshots.at(-1);
    return latest?.finished ? latest : undefined;
  }

  get index(): number {
    return this.currentFrameIndex;
  }

  get length(): number {
    return this.recordedSnapshots.length;
  }

  get hasNextFrame(): boolean {
    return this.currentFrameIndex < this.recordedSnapshots.length - 1;
  }

  resetToInitialSnapshot(snapshot: Snapshot): void {
    this.replaceRecordedHistory([snapshot]);
  }

  loadRecordedReplay(replay: Replay): void {
    const replaySnapshots = [
      replay.initial,
      ...replay.frames.map((frame) => ({
        config: replay.initial.config,
        map: getHazardMap(replay.initial.map, frame.world, frame.tick),
        ...frame,
      })),
    ];

    this.replaceRecordedHistory(replaySnapshots);
  }

  appendLiveSnapshot(snapshot: Snapshot): void {
    this.recordedSnapshots.push(snapshot);
    this.currentFrameIndex = this.recordedSnapshots.length - 1;
  }

  seekRecordedFrame(index: number): void {
    const target = Number.isNaN(index) ? 0 : Math.trunc(index);
    this.currentFrameIndex = Math.max(0, Math.min(this.length - 1, target));
  }

  advanceRecordedFrame(): boolean {
    if (!this.hasNextFrame) return false;

    this.currentFrameIndex++;

    return true;
  }

  getRecentEvents(maximumEvents: number): GameEvent[] {
    const recentEvents: GameEvent[] = [];

    for (let frameIndex = this.currentFrameIndex; frameIndex >= 0; frameIndex--) {
      const needsMoreEvents = recentEvents.length < maximumEvents;
      if (!needsMoreEvents) break;

      const snapshot = this.recordedSnapshots[frameIndex];
      if (!snapshot) break;

      const frameEvents = snapshot.events.slice().reverse();
      recentEvents.push(...frameEvents.slice(0, maximumEvents - recentEvents.length));
    }

    return recentEvents;
  }

  private replaceRecordedHistory(snapshots: Snapshot[]): void {
    this.recordedSnapshots = snapshots;
    this.currentFrameIndex = 0;
  }
}
