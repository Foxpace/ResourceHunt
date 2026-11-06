import type { BotState, Snapshot } from "../../engine/types.ts";
import { botMonogram } from "./board-units.ts";
import { escapeHtml } from "./panels.ts";

export interface OverlayState {
  snapshot?: Snapshot;
  playing: boolean;
  canPlay: boolean;
  isReplay: boolean;
}

/** Board prompts: a start button before the first tick and a victory card after the last. */
export class ArenaOverlays {
  private dismissedFinal?: Snapshot;
  private ready = document.getElementById("ready-overlay")!;
  private finish = document.getElementById("finish-overlay")!;

  render(state: OverlayState, finalSnapshot?: Snapshot): void {
    const atStart = state.snapshot?.tick === 0;
    const waiting = !state.playing;
    const showReady = atStart && waiting && state.canPlay;
    this.ready.hidden = !showReady;
    document.getElementById("ready-caption")!.textContent = state.isReplay
      ? "Replay loaded"
      : "Arena ready";

    const showingFinal = !!finalSnapshot && state.snapshot === finalSnapshot;
    const dismissed = this.dismissedFinal === finalSnapshot;
    const showFinish = showingFinal && !dismissed && waiting;
    this.finish.hidden = !showFinish;
    if (showFinish)
      document.getElementById("finish-body")!.innerHTML = renderVictory(finalSnapshot);
  }

  dismissFinish(finalSnapshot?: Snapshot): void {
    this.dismissedFinal = finalSnapshot;
    this.finish.hidden = true;
  }
}

function renderVictory(snapshot: Snapshot): string {
  const ranked = [...snapshot.bots].sort((first, second) => second.score - first.score);
  const winners = ranked.filter((bot) => bot.score === ranked[0]?.score);
  const title = winners.length > 1 ? "Shared victory" : `${winners[0]?.name ?? "Nobody"} wins`;
  const champion = winners[0];
  const runnersUp = ranked
    .slice(1, 4)
    .map((bot, index) => renderRunnerUp(bot, index + 2))
    .join("");

  return `<div class="champion" style="--bot-color:${champion?.color ?? "#c9eca1"}">
      <span class="champion-token">${escapeHtml(botMonogram(champion?.name ?? "?"))}</span>
      <h2 id="finish-title">${escapeHtml(title)}</h2>
      <p><b>${champion?.score ?? 0}</b> points · ${champion?.delivered ?? 0} items banked</p>
    </div>
    <ol class="runners-up">${runnersUp}</ol>`;
}

function renderRunnerUp(bot: BotState, place: number): string {
  return `<li style="--bot-color:${bot.color}"><span>${place}</span><i></i>${escapeHtml(bot.name)}<b>${bot.score}</b></li>`;
}
