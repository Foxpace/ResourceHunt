import { MAX_BOTS } from "../engine/types.ts";
import { WorkerBot } from "./worker-controller.ts";
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

/** Demonstrate competitive play by default while retaining custom-folder discovery. */
export function getDefaultBotIds(catalog: BotCatalog): string[] {
  const preferred = ["courier", "nearest", "prospector", "strategist"];
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
  if (ids.length < 1 || ids.length > MAX_BOTS || new Set(ids).size !== ids.length) {
    throw new Error(`Select 1 to ${MAX_BOTS} unique bot IDs`);
  }
  return ids.map((id) => {
    const bot = catalog.bots.find((bot) => bot.id === id);
    if (!bot) throw new Error(`Unknown bot: ${String(id)}. Run yarn bots to list IDs.`);
    return bot;
  });
}

export async function discoverBots(directory = BOT_DIRECTORY): Promise<BotCatalog> {
  const catalog: BotCatalog = { bots: [], errors: [] };
  const files: string[] = [];
  async function walk(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        !/\.(test|spec|d)\.ts$/.test(entry.name)
      )
        files.push(file);
    }
  }
  await walk(directory);
  for (const file of files.sort()) {
    const worker = new WorkerBot({ id: "", name: "", description: "", file }, 100);
    try {
      const metadata = await worker.init("inspect", true);
      if (catalog.bots.some((bot) => bot.id === metadata.id))
        throw new Error(`Duplicate bot ID: ${metadata.id}`);
      catalog.bots.push({ ...metadata, file });
    } catch (error) {
      catalog.errors.push({
        file: relative(directory, file),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      worker.dispose();
    }
  }
  return catalog;
}

export async function createControllers(
  descriptors: BotDescriptor[],
  config: GameConfig,
): Promise<BotController[]> {
  const controllers: WorkerBot[] = [];
  try {
    for (const descriptor of descriptors) {
      const controller = new WorkerBot(descriptor, config.decisionTimeoutMs);
      controllers.push(controller);
      await controller.init(`${config.seed}:bot:${descriptor.id}`);
      if (controller.metadata.id !== descriptor.id)
        throw new Error("Bot metadata changed since discovery; refresh the bot list");
    }
    return controllers;
  } catch (error) {
    for (const controller of controllers) controller.dispose();
    throw error;
  }
}
