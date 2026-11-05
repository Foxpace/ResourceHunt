import type { BotDescriptor } from "./bots.ts";

/** Repeated strategies become independent participants before execution or base rotation. */
export function createBotLineup(descriptors: BotDescriptor[]): BotDescriptor[] {
  const totals = countStrategies(descriptors);
  const occurrences = new Map<string, number>();
  const reservedIds = new Set(descriptors.map((descriptor) => descriptor.id));

  return descriptors.map((descriptor) => {
    if (totals.get(descriptor.id) === 1) return { ...descriptor };

    const copyNumber = (occurrences.get(descriptor.id) ?? 0) + 1;
    occurrences.set(descriptor.id, copyNumber);
    const id = createReplicaId(descriptor.id, copyNumber, reservedIds);
    reservedIds.add(id);
    const suffix = ` #${copyNumber}`;

    return {
      ...descriptor,
      id,
      strategyId: descriptor.strategyId ?? descriptor.id,
      name: descriptor.name.slice(0, 60 - suffix.length) + suffix,
    };
  });
}

function countStrategies(descriptors: BotDescriptor[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const descriptor of descriptors)
    totals.set(descriptor.id, (totals.get(descriptor.id) ?? 0) + 1);

  return totals;
}

function createReplicaId(strategyId: string, copyNumber: number, reservedIds: Set<string>): string {
  let attempt = 1;
  while (true) {
    const suffix = `-copy-${copyNumber}${attempt === 1 ? "" : `-${attempt}`}`;
    const candidate = strategyId.slice(0, 48 - suffix.length) + suffix;
    if (!reservedIds.has(candidate)) return candidate;

    attempt++;
  }
}
