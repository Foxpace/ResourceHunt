import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRETTIER_SKIPPED = "SKIP  formatting (Prettier is unavailable)";
export const PRETTIER_CONFIG_ARGS = [
  "--config",
  fileURLToPath(new URL("../.prettierrc.json", import.meta.url)),
  "--no-editorconfig",
];

export function findPrettier(root) {
  const path = resolve(root, "node_modules/prettier/bin/prettier.cjs");

  return existsSync(path) ? path : null;
}

function main() {
  const prettier = findPrettier(process.cwd());
  if (!prettier) {
    console.log(PRETTIER_SKIPPED);

    return 0;
  }

  const args = [prettier, ...PRETTIER_CONFIG_ARGS, ...process.argv.slice(2)];
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) console.error(result.error.message);

  return result.status ?? 1;
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) process.exitCode = main();
