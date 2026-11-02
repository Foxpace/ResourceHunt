import { normalizeConfig } from "../engine/config.ts";
import type { GameConfig } from "../engine/types.ts";

export const HELP = `Resource hunt · Node.js bot simulator

  yarn bots
  yarn play [options]
  yarn bench [options] --matches 20

Options:
  --bots <ids>          1..15 comma-separated bot IDs, default four examples
  --biome <name>        Map template, default riverlands
                       riverlands, valley, desert, moon, volcanic,
                       archipelago, tundra, forest
  --seed <text>         Reproducible seed, default resource-hunt
  --ticks <n>           Ticks per match, default 300
  --width <n>           Map width, 13..81, default 33
  --height <n>          Map height, 13..81, default 25
  --layout <name>       edges or center, default edges
  --resources <0..0.65> Resource density, default 0.13
  --terrain <0..0.65>   Terrain roughness, default 0.28
  --capacity <n>        Bag weight limit, default 8
  --timeout <ms>        Bot decision deadline, default 100
  --hotspots <n>       Contested resource clusters, 0..6, default 2
  --outposts <n>       Capturable banks, 0..6, default 2
  --capture-turns <n>  Consecutive capture turns, default 3
  --stealing <bool>    true or false, default true
  --steal-cooldown <n> Ticks between successful thefts, default 5
  --matches <n>         Benchmark matches, default 20
  --json               Machine-readable stdout
  --output <path>      Also save JSON results to a file
  --replay <path>      Save a replay for UI import, play only
  --help               Show this help

Larger lineups require more room: 15 bots need at least 25 × 25 cells.
Benchmarks rotate starting bases. Each group of N matches uses the same map
seed, with N equal to the selected bot count. Use a multiple of N for balance.
Exit codes: 0 success, 1 input/runtime failure, 2 completed with bot errors.
`;

export function parseArguments(args: readonly string[]) {
  const values = [...args];
  const command = values[0] && !values[0].startsWith("--") ? values.shift()! : "play";
  const flags = new Map<string, string>();
  for (let i = 0; i < values.length; i++) {
    const key = values[i]!;
    if (!/^--[a-z]+(?:-[a-z]+)*$/.test(key)) throw new Error(`Unexpected argument: ${key}`);
    if (["--json", "--help"].includes(key)) flags.set(key.slice(2), "true");
    else {
      const value = values[++i];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for ${key}`);
      flags.set(key.slice(2), value);
    }
  }
  if (flags.has("help")) return { command, flags };
  const allowed = new Set([
    "bots",
    "biome",
    "seed",
    "ticks",
    "width",
    "height",
    "layout",
    "resources",
    "terrain",
    "capacity",
    "timeout",
    "hotspots",
    "outposts",
    "capture-turns",
    "stealing",
    "steal-cooldown",
    "matches",
    "json",
    "output",
    "replay",
  ]);
  for (const flag of flags.keys())
    if (!allowed.has(flag)) throw new Error(`Unknown option: --${flag}`);
  if (!["play", "bench", "bots"].includes(command)) throw new Error(`Unknown command: ${command}`);
  if (command !== "bench" && flags.has("matches"))
    throw new Error("--matches is only available with bench");
  if (command !== "play" && flags.has("replay"))
    throw new Error("--replay is only available with play");
  return { command, flags };
}

export function configFromFlags(flags: ReadonlyMap<string, string>): GameConfig {
  const partial: Partial<GameConfig> = {};
  const mapping = {
    width: "width",
    height: "height",
    ticks: "ticks",
    resources: "resourceDensity",
    terrain: "terrainDensity",
    capacity: "capacity",
    timeout: "decisionTimeoutMs",
    hotspots: "hotspotCount",
    outposts: "outpostCount",
    "capture-turns": "captureTurns",
    "steal-cooldown": "stealCooldownTicks",
  } as const;
  for (const [flag, key] of Object.entries(mapping))
    if (flags.has(flag)) partial[key] = Number(flags.get(flag));
  if (flags.has("biome")) partial.biome = flags.get("biome") as GameConfig["biome"];
  if (flags.has("seed")) partial.seed = flags.get("seed")!;
  if (flags.has("layout")) partial.baseLayout = flags.get("layout") as GameConfig["baseLayout"];
  if (flags.has("stealing")) {
    const value = flags.get("stealing");
    if (value !== "true" && value !== "false") throw new Error("stealing must be true or false");
    partial.stealing = value === "true";
  }
  return normalizeConfig(partial);
}
