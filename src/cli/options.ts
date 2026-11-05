import { normalizeConfig } from "../engine/config.ts";
import type { GameConfig } from "../engine/types.ts";

export const HELP = `Resource Hunt · Node.js bot simulator

  yarn bots
  yarn play [options]
  yarn bench [options] --matches 20
  yarn tournament [options] --wins 3
  yarn inspect --input <file> [--round <n> | --biome <name>] [--tick <n>]

Options:
  --bots <ids>          1..15 comma-separated entries; repeat IDs for copies
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
  --capture-immunity <n> Protected rounds after capture, 0..20, default 3
  --capture-turns <n>  Consecutive capture turns, default 3
  --stealing <bool>    true or false, default true
  --steal-cooldown <n> Ticks between successful thefts, default 5
  --sabotage <bool>    Depot sabotage, default true
  --cargo-traps <bool> Visible cargo traps, default true
  --scavengers <n>     Scavenger drones, 0..6, default 2
  --guardians <n>      Guarded hotspots, 0..6, default 2
  --natural-events <bool> Forecast biome hazards, default true
  --matches <n>         Benchmark matches, default 20
  --wins <n>            Tournament win target, 1..10, default 3
  --standout-badges <n> Standout badges, 0..30, default 3
  --random-badges <n>   Random badges, 0..30, default 5
  --stats <keys>        Counter names to display, comma-separated, or none
  --input <path>        Tournament JSON or match replay for inspect
  --round <n>           Inspect a tournament round, numbered from 1
  --tick <n>            Inspect scores and recorded stats at this tick
  --bot <id>            Inspect one bot or replica by participant ID
  --map                 Draw the map when inspecting a match replay
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
  const firstArgument = values[0];
  const hasExplicitCommand = firstArgument ? !firstArgument.startsWith("--") : false;
  const command = hasExplicitCommand ? values.shift()! : "play";
  const flags = parseFlags(values);
  if (flags.has("help")) return { command, flags };

  for (const flag of flags.keys())
    if (!ALLOWED_FLAGS.has(flag)) throw new Error(`Unknown option: --${flag}`);

  if (!["play", "bench", "bots", "tournament", "inspect"].includes(command))
    throw new Error(`Unknown command: ${command}`);

  const matchesFlagUnsupported = command !== "bench" && flags.has("matches");
  if (matchesFlagUnsupported) throw new Error("--matches is only available with bench");

  const replayFlagUnsupported = command !== "play" && flags.has("replay");
  if (replayFlagUnsupported) throw new Error("--replay is only available with play");

  const winFlagUnsupported = command !== "tournament" && flags.has("wins");
  if (winFlagUnsupported) throw new Error("--wins is only available with tournament");
  validateInspectionFlags(command, flags);
  return { command, flags };
}

function validateInspectionFlags(command: string, flags: ReadonlyMap<string, string>): void {
  if (command === "inspect") {
    if (!flags.has("input")) throw new Error("inspect requires --input");
    return;
  }
  for (const flag of ["input", "round", "tick", "bot", "map"]) {
    if (flags.has(flag)) throw new Error(`--${flag} is only available with inspect`);
  }
}

export function integerFlag(
  flags: ReadonlyMap<string, string>,
  name: string,
  range: { min: number; max: number; fallback: number },
): number {
  const raw = flags.get(name);
  if (raw === undefined) return range.fallback;
  const value = Number(raw);
  const containsOnlyDigits = /^\d+$/.test(raw);
  const isSafeInteger = Number.isSafeInteger(value);
  const withinRange = value >= range.min && value <= range.max;
  const validFlagValue = containsOnlyDigits && isSafeInteger && withinRange;
  if (!validFlagValue)
    throw new Error(`--${name} must be an integer from ${range.min} to ${range.max}`);
  return value;
}

export function configFromFlags(flags: ReadonlyMap<string, string>): GameConfig {
  const partial: Partial<GameConfig> = {};

  for (const [flag, key] of Object.entries(NUMERIC_FLAGS))
    if (flags.has(flag)) partial[key] = Number(flags.get(flag));

  if (flags.has("biome")) partial.biome = flags.get("biome") as GameConfig["biome"];
  if (flags.has("seed")) partial.seed = flags.get("seed")!;
  if (flags.has("layout")) partial.baseLayout = flags.get("layout") as GameConfig["baseLayout"];
  applyBooleanFlags(partial, flags);

  return normalizeConfig(partial);
}

const BOOLEAN_FLAGS = {
  stealing: "stealing",
  sabotage: "sabotage",
  "cargo-traps": "cargoTraps",
  "natural-events": "naturalEvents",
} as const;

function applyBooleanFlags(partial: Partial<GameConfig>, flags: ReadonlyMap<string, string>): void {
  for (const [flag, key] of Object.entries(BOOLEAN_FLAGS)) {
    if (!flags.has(flag)) continue;

    const value = flags.get(flag);
    const invalid = value !== "true" && value !== "false";
    if (invalid) throw new Error(`${flag} must be true or false`);

    partial[key] = value === "true";
  }
}

const ALLOWED_FLAGS = new Set([
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
  "capture-immunity",
  "stealing",
  "steal-cooldown",
  "sabotage",
  "cargo-traps",
  "scavengers",
  "guardians",
  "natural-events",
  "matches",
  "wins",
  "standout-badges",
  "random-badges",
  "stats",
  "input",
  "round",
  "tick",
  "bot",
  "map",
  "json",
  "output",
  "replay",
]);

function parseFlags(values: string[]): Map<string, string> {
  const flags = new Map<string, string>();

  for (let index = 0; index < values.length; index++) {
    const key = values[index]!;
    if (!/^--[a-z]+(?:-[a-z]+)*$/.test(key)) throw new Error(`Unexpected argument: ${key}`);
    if (["--json", "--help", "--map"].includes(key)) {
      flags.set(key.slice(2), "true");
      continue;
    }

    const value = values[++index];

    const missingFlagValue = value === undefined || value.startsWith("--");
    if (missingFlagValue) throw new Error(`Missing value for ${key}`);

    flags.set(key.slice(2), value);
  }

  return flags;
}

const NUMERIC_FLAGS = {
  scavengers: "scavengerCount",
  guardians: "guardianCount",
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
  "capture-immunity": "captureImmunityTicks",
  "steal-cooldown": "stealCooldownTicks",
} as const;
