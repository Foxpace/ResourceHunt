import { defaultBadgeOptions, type selectAwards } from "../competition/awards.ts";
import { createMatchStatistics } from "../engine/match-statistics.ts";
import { integerFlag } from "./options.ts";

export function badgeOptionsFromFlags(
  flags: ReadonlyMap<string, string>,
  defaults = defaultBadgeOptions,
) {
  return {
    standout: integerFlag(flags, "standout-badges", {
      min: 0,
      max: 30,
      fallback: defaults.standout,
    }),
    random: integerFlag(flags, "random-badges", { min: 0, max: 30, fallback: defaults.random }),
  };
}

const optionalColumns = [
  "delivered",
  "captures",
  "stolen",
  "lost",
  "errors",
  "outpostsOwned",
  "meanOutpostsOwned",
  "carriedValue",
  "disabled",
];

const counterNames = Object.keys(createMatchStatistics());

export function printStandings<T extends { id: string; statistics?: object }>(
  rows: T[],
  flags: ReadonlyMap<string, string>,
) {
  const selected = flags.get("stats")?.split(",");
  console.table(rows.map(({ statistics, ...row }) => filterColumns(row, selected)));

  const fields = selected?.filter((field) => counterNames.includes(field)) ?? counterNames;
  if (!fields.length) return;

  console.table(
    rows.map(({ id, statistics }) => ({
      id,
      ...Object.fromEntries(
        fields.map((field) => [
          field,
          (statistics as Record<string, unknown> | undefined)?.[field] ?? "—",
        ]),
      ),
    })),
  );
}

function filterColumns(row: object, selected?: string[]) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => {
      const optional = optionalColumns.includes(key);
      const visible = !selected || selected.includes(key);
      return !optional || visible;
    }),
  );
}

export function validateStatisticFlags(flags: ReadonlyMap<string, string>): void {
  const selection = flags.get("stats");
  const customSelection = selection !== undefined && selection !== "none";
  if (!customSelection) return;
  const names = [...optionalColumns, ...counterNames];
  for (const field of selection.split(",")) {
    if (!names.includes(field)) {
      throw new Error(`Unknown statistic ${field}. Choose from ${names.join(", ")}`);
    }
  }
}

export function printBadges(badges: ReturnType<typeof selectAwards>): void {
  for (const [label, group] of [
    ["Standout badges", badges.prominent],
    ["Random badges", badges.extras],
  ] as const) {
    if (!group.length) continue;
    console.log(label);
    for (const badge of group) {
      const winners = badge.winners.map((winner) => winner.name).join(", ");
      console.log(`  ${badge.icon} ${badge.title} · ${winners} · ${badge.value}`);
    }
  }
}
