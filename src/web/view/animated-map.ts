import type { Snapshot } from "../../engine/types.ts";
import { MapMotion } from "../model/map-motion.ts";
import { drawMap, releaseTerrainCache } from "./map.ts";

export class AnimatedMapView {
  private state?: Snapshot;
  private motion = new MapMotion();
  private frameId = 0;
  private disposed = false;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private canvas: HTMLCanvasElement) {
    this.reducedMotion.addEventListener("change", this.refreshMotionPreference);
  }

  update(state: Snapshot): void {
    this.motion.acceptSnapshot(state, performance.now());
    this.state = state;
    this.renderFrame();
    this.scheduleFrame();
  }

  resize(): void {
    this.renderFrame();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    this.reducedMotion.removeEventListener("change", this.refreshMotionPreference);
    releaseTerrainCache(this.canvas);
  }

  private refreshMotionPreference = (): void => {
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.renderFrame();
    this.scheduleFrame();
  };

  private renderFrame(): void {
    const state = this.state;
    if (!state) return;
    if (this.disposed) return;

    drawMap(
      this.canvas,
      state,
      this.motion.animation(performance.now(), this.reducedMotion.matches),
    );
  }

  private scheduleFrame(): void {
    const unavailable = this.disposed || this.reducedMotion.matches || !!this.frameId;
    if (unavailable) return;

    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      if (!document.hidden) this.renderFrame();

      this.scheduleFrame();
    });
  }
}
