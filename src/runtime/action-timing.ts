import { isValidBotAction } from "../engine/game.ts";
import type { Action, BotController } from "../engine/types.ts";

type ActionType = Action["type"];

interface TimingTotal {
  actions: number;
  totalMs: number;
}

interface ActionTimingSummary extends TimingTotal {
  meanMsPerAction: number | null;
  meanMsPerTick: number;
}

export interface BotActionTiming extends ActionTimingSummary {
  id: string;
  byAction: (ActionTimingSummary & { action: ActionType })[];
}

export class ActionTiming {
  private byBot = new Map<string, Map<ActionType, TimingTotal>>();

  wrap = (controller: BotController): BotController => ({
    metadata: controller.metadata,
    decide: async (observation) => {
      const startedAt = performance.now();
      const decision = await controller.decide(observation);
      const elapsedMs = performance.now() - startedAt;
      if (decision.error) return decision;
      if (isValidBotAction(decision.action)) {
        this.record(controller.metadata.id, decision.action.type, elapsedMs);
      }

      return decision;
    },
    dispose: () => controller.dispose(),
  });

  private record(id: string, action: ActionType, elapsedMs: number): void {
    const byAction = this.byBot.get(id) ?? new Map<ActionType, TimingTotal>();
    const total = byAction.get(action) ?? { actions: 0, totalMs: 0 };
    total.actions++;
    total.totalMs += elapsedMs;
    byAction.set(action, total);
    this.byBot.set(id, byAction);
  }

  summarize(id: string, ticks: number): BotActionTiming {
    const entries = [...(this.byBot.get(id) ?? [])];
    const byAction = entries.map(([action, total]) => ({ action, ...summarize(total, ticks) }));
    const total = { actions: 0, totalMs: 0 };
    for (const row of byAction) {
      total.actions += row.actions;
      total.totalMs += row.totalMs;
    }

    return { id, ...summarize(total, ticks), byAction };
  }
}

function summarize(total: TimingTotal, ticks: number): ActionTimingSummary {
  return {
    ...total,
    meanMsPerAction: total.actions ? total.totalMs / total.actions : null,
    meanMsPerTick: total.totalMs / ticks,
  };
}
