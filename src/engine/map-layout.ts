import { MAX_BOTS, type Biome, type GameConfig, type Position } from "./types.ts";

/** Crowded lineups need room for separate bases and equal opening supplies. */
export function minimumMapSize(botCount: number, biome: Biome): number {
  const starts = botCount <= 8 ? 13 : Math.ceil(botCount * 0.65) * 2 + 5;
  const islandGrid = Math.max(3, Math.ceil(botCount / 4) + 1);

  return Math.max(starts, biome === "archipelago" ? islandGrid * 4 - 1 : 13);
}

export function placeBases(config: GameConfig, botCount: number): Position[] {
  const integerBotCount = Number.isInteger(botCount);
  const validBotCount = integerBotCount ? botCount >= 1 && botCount <= MAX_BOTS : false;
  if (!validBotCount) throw new Error(`Select between 1 and ${MAX_BOTS} bots`);

  const minimum = minimumMapSize(botCount, config.biome);
  if (Math.min(config.width, config.height) < minimum)
    throw new Error(
      `${botCount} bots on ${config.biome} need width and height of at least ${minimum} for balanced starts`,
    );

  const centerX = (config.width - 1) / 2,
    centerY = (config.height - 1) / 2;
  const radius = (half: number) =>
    config.baseLayout === "edges"
      ? half - 3
      : Math.min(half - 3, Math.max(3, half * 0.35, botCount * 0.65));

  return Array.from({ length: botCount }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / botCount;
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    const scale = config.baseLayout === "edges" ? 1 / Math.max(Math.abs(dx), Math.abs(dy)) : 1;

    return {
      x: Math.round(centerX + dx * radius(centerX) * scale),
      y: Math.round(centerY + dy * radius(centerY) * scale),
    };
  });
}
