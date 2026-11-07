import { createBotLineup } from "./lineup.ts";
import { MAX_BOTS } from "../engine/types.ts";
import { WorkerBot } from "./worker-controller.ts";
import { checkBotSource } from "./bot-source.ts";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import type { BotController, BotMetadata, GameConfig } from "../engine/types.ts";

export const BOT_DIRECTORY = fileURLToPath(new URL("../../bots", import.meta.url));
export interface BotDescriptor extends BotMetadata {
  file: string;
}
export interface BotCatalog {
  bots: BotDescriptor[];
  errors: { file: string; error: string }[];
}

/** Start with the simple baseline, then fill the lineup with other discovered bots. */
export function getDefaultBotIds(catalog: BotCatalog): string[] {
  const preferred = ["nearest"];
  const available = new Set(catalog.bots.map((bot) => bot.id));
  const selected = new Set(
    [
      ...new Set([
        ...preferred.filter((id) => available.has(id)),
        ...catalog.bots.map((bot) => bot.id),
      ]),
    ].slice(0, 4),
  );

  // Keep the same order as the UI's discovered-bot checkboxes.
  return catalog.bots.filter((bot) => selected.has(bot.id)).map((bot) => bot.id);
}

/** Resolve a lineup in the supplied order, shared by the CLI and HTTP adapter. */
export function selectBots(catalog: BotCatalog, ids: readonly unknown[]): BotDescriptor[] {
  const invalidLineup = ids.length < 1 || ids.length > MAX_BOTS;
  if (invalidLineup) {
    throw new Error(`Select 1 to ${MAX_BOTS} bot instances`);
  }

  return createBotLineup(
    ids.map((id) => {
      const bot = catalog.bots.find((bot) => bot.id === id);
      if (!bot) throw new Error(`Unknown bot: ${String(id)}. Run yarn bots to list IDs.`);

      return bot;
    }),
  );
}

export async function discoverBots(directory = BOT_DIRECTORY): Promise<BotCatalog> {
  const catalog: BotCatalog = { bots: [], errors: [] };
  const files = await discoverBotFiles(directory);

  for (const file of files.sort()) {
    try {
      const { metadata } = await checkBotSource(file);
      registerInspectedBot(catalog, { ...metadata, file });
    } catch (error) {
      catalog.errors.push({
        file: relative(directory, file),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return catalog;
}

export async function createControllers(
  descriptors: BotDescriptor[],
  config: GameConfig,
): Promise<BotController[]> {
  const controllers: WorkerBot[] = [];
  const lineup = await Promise.all(createBotLineup(descriptors).map(checkSelectedBot));
  try {
    for (const { descriptor, source } of lineup) {
      controllers.push(new WorkerBot(descriptor, source, config.decisionTimeoutMs));
    }

    await Promise.all(
      controllers.map((controller) =>
        controller.init(`${config.seed}:bot:${controller.metadata.id}`),
      ),
    );
    return controllers;
  } catch (error) {
    for (const controller of controllers) controller.dispose();

    throw error;
  }
}

async function checkSelectedBot(descriptor: BotDescriptor) {
  const source = await checkBotSource(descriptor.file);
  const strategyId = descriptor.strategyId ?? descriptor.id;
  if (source.metadata.id !== strategyId)
    throw new Error("Bot metadata changed since discovery; refresh the bot list");

  return { descriptor, source };
}

async function discoverBotFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function collectBotSourceFiles(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const hiddenEntry = entry.name.startsWith("_") || entry.name.startsWith(".");
      if (hiddenEntry) continue;

      const file = join(folder, entry.name);
      if (entry.isDirectory()) {
        await collectBotSourceFiles(file);
        continue;
      }

      const isFile = entry.isFile();
      const isTypeScript = entry.name.endsWith(".ts");
      const isTestOrDeclaration = /\.(test|spec|d)\.ts$/.test(entry.name);
      const botSourceFile = isFile && isTypeScript && !isTestOrDeclaration;
      if (botSourceFile) files.push(file);
    }
  }
  await collectBotSourceFiles(directory);

  return files;
}

function registerInspectedBot(catalog: BotCatalog, descriptor: BotDescriptor): void {
  if (catalog.bots.some((bot) => bot.id === descriptor.id))
    throw new Error(`Duplicate bot ID: ${descriptor.id}`);

  catalog.bots.push(descriptor);
}
