import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isMainModule(url: string): boolean {
  return !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
}
