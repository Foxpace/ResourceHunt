import assert from "node:assert/strict";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeConfig } from "../src/engine/config.ts";
import { checkBotSource } from "../src/runtime/bot-source.ts";
import { createControllers, discoverBots } from "../src/runtime/bots.ts";
import { WorkerBot } from "../src/runtime/worker-controller.ts";
import { createBotDirectory, runWorkerMatch } from "./helpers/runtime-fixtures.ts";

test("discovery lists a valid bot without executing its module", async (context) => {
  // Given
  const directory = await createBotDirectory(context, { "bot.ts": VALID_BOT });
  const marker = join(directory, "marker");
  await writeFile(join(directory, "bot.ts"), markerWrite(marker) + VALID_BOT);

  // When
  const catalog = await discoverBots(directory);

  // Then
  assert.equal(catalog.bots[0]?.id, "checked");
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("discovery rejects malformed bot metadata without running the module", async (context) => {
  // Given
  const directory = await createBotDirectory(context, {});
  const marker = join(directory, "marker");
  const invalid = VALID_BOT.replace('id: "checked"', 'id: "INVALID"');
  await writeFile(join(directory, "bad.ts"), markerWrite(marker) + invalid);

  // When
  const catalog = await discoverBots(directory);

  // Then
  assert.match(catalog.errors[0]!.error, /metadata id/);
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("match startup rejects a changed bot ID before evaluating the entry", async (context) => {
  // Given
  const directory = await createBotDirectory(context, { "bot.ts": VALID_BOT });
  const { bots } = await discoverBots(directory);
  const marker = join(directory, "marker");
  const changed = VALID_BOT.replace('id: "checked"', 'id: "changed"');
  await writeFile(bots[0]!.file, markerWrite(marker) + changed);

  // When
  const start = createControllers(bots, normalizeConfig());

  // Then
  await assert.rejects(start, /metadata changed since discovery/);
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("a worker imports the source snapshot it received after checking", async (context) => {
  // Given
  const directory = await createBotDirectory(context, { "bot.ts": VALID_BOT });
  const file = join(directory, "bot.ts");
  const checked = await checkBotSource(file);
  await writeFile(file, 'throw new Error("unchecked entry executed");');
  const worker = new WorkerBot({ ...checked.metadata, file }, checked, 100);
  context.after(() => worker.dispose());

  // When
  const metadata = await worker.init("snapshot");

  // Then
  assert.deepEqual(metadata, checked.metadata);
});

test("a checked bot can load a relative helper during its decision", async (context) => {
  // Given
  const source = VALID_BOT.replace(
    'return { type: "skip" };',
    'return (await import("./_action.ts")).action;',
  );
  const directory = await createBotDirectory(context, {
    "bot.ts": source,
    "_action.ts": 'export const action = { type: "skip" } as const;',
    "package.json": '{"type":"module"}',
  });
  const { bots } = await discoverBots(directory);

  // When
  const match = await runWorkerMatch(bots, { ticks: 2 });

  // Then
  assert.equal(match.standings[0]!.errors, 0);
});

const VALID_BOT = `export default class {
  static metadata = { id: "checked", name: "Checked", description: "Test" } as const;
  async act() { return { type: "skip" }; }
}`;

function markerWrite(marker: string): string {
  return `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran");\n`;
}
