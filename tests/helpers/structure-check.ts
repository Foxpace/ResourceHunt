import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const checkerPath = fileURLToPath(new URL("../../scripts/check-structure.mjs", import.meta.url));

/** Run the project's actual checker against an isolated set of source files. */
export async function runStructureCheck(filePath: string, source: string) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "resource-game-structure-"));

  try {
    const fixturePath = join(fixtureDirectory, filePath);
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(fixturePath, source);

    return await executeFile(process.execPath, [checkerPath], { cwd: fixtureDirectory });
  } finally {
    await rm(fixtureDirectory, { recursive: true });
  }
}

export function createTestSource(lines: number, sections = ["Given", "When", "Then"]): string {
  const statements = sections.flatMap((section) => [`// ${section}`, "void 0;"]);
  const padding = Array<string>(Math.max(0, lines - statements.length - 2)).fill("");

  return ['test("example", () => {', ...statements, ...padding, "});"].join("\n");
}
