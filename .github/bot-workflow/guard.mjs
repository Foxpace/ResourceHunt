import { lstatSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const BIOMES = [
  "riverlands",
  "valley",
  "desert",
  "moon",
  "volcanic",
  "archipelago",
  "tundra",
  "forest",
];
export const STAGES = {
  intention: { artifact: "INTENTION.md", needs: [] },
  design: { artifact: "DESIGN.md", needs: ["INTENTION.md"] },
  plan: { artifact: "PLAN.md", needs: ["INTENTION.md", "DESIGN.md"] },
  build: { artifact: "BUILD.md", needs: ["INTENTION.md", "DESIGN.md", "PLAN.md"] },
  review: {
    artifact: "REVIEW.md",
    needs: ["INTENTION.md", "DESIGN.md", "PLAN.md", "BUILD.md"],
  },
};
export const APPROVERS = {
  "INTENTION.md": "intent owner",
  "DESIGN.md": "intent owner",
  "PLAN.md": "agent orchestrator",
  "BUILD.md": "agent orchestrator",
  "REVIEW.md": "risk owner",
};
const EVERY_STAGE = Object.keys(STAGES);
export const OPERATIONS = {
  status: EVERY_STAGE,
  baseline: EVERY_STAGE,
  check: ["build", "review"],
  test: ["build", "review"],
  bench: ["build", "review"],
  play: ["build", "review"],
  format: ["build"],
  holdout: ["review"],
};
const UNGATED = new Set(["status", "baseline"]);
const SLUG = "[a-z][a-z0-9-]{0,47}";
const ARTIFACT = new RegExp(`^bots/(${SLUG})/_workflow/([A-Z]+\\.md)$`);
const CODE = new RegExp(`^bots/(${SLUG})(?:\\.ts|/(?!_workflow/).+\\.ts)$`);
const RUNNER = new RegExp(
  `^node \\.github/bot-workflow/run\\.mjs (\\w+) (${SLUG}) ([a-z]+)(?: (${BIOMES.join("|")}))?$`,
);
const CD_PREFIX = /^cd\s+("?)([^"&]+)\1\s*&&\s*(.+)$/;
const APPROVED_STATUS = /^[\W_]*status[\W_]*:[\W_]*approved\b/im;
const SIGNATURE = /^[\W_]*approved by[\W_]*:[ \t*_]*[^\s<*_]/im;
const SAFE_TOOLS =
  /^(read_file|file_search|grep_search|semantic_search|list_dir|get_errors|get_terminal_output|terminal_last_command|vscode_listCodeUsages|vscode[/_]askQuestions|read|search|list_files|grep|rg|glob|view|ask_user|AskUserQuestion|update_todo|manage_todo_list|TodoWrite)$/i;
const TERMINAL_TOOLS = /^(run_in_terminal|execute|bash|powershell)$/i;
const EDIT_TOOLS =
  /^(apply_patch|create_file|create|replace_string_in_file|multi_replace_string_in_file|insert_edit_into_file|str_replace_editor|edit|write)$/i;

export function isApproved(content) {
  return APPROVED_STATUS.test(content) && SIGNATURE.test(content);
}

export function safePath(root, candidate) {
  if (typeof candidate !== "string") throw new Error("Missing file path.");
  const absolute = resolve(root, candidate);
  const local = relative(root, absolute).split(sep).join("/");
  if (!local.startsWith("bots/"))
    throw new Error(`${local} is protected. Agents write only in bots/.`);

  let current = absolute;
  while (current !== resolve(root)) {
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error("Symlink writes are forbidden.");
    current = dirname(current);
  }

  return local;
}

export function readArtifact(context) {
  const { root, folder, name } = context;
  const path = resolve(root, folder, name);
  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) return null;

  return readFileSync(path, "utf8");
}

function stageOf(name) {
  return EVERY_STAGE.find((stage) => STAGES[stage].artifact === name);
}

export function checkInputs(context) {
  const { root, folder, stage } = context;
  for (const name of STAGES[stage].needs) {
    const content = readArtifact({ root, folder, name });
    if (content === null)
      throw new Error(`${folder}/${name} is missing. Finish the ${stageOf(name)} stage first.`);
    if (!isApproved(content))
      throw new Error(
        `${folder}/${name} is not approved yet. Ask the ${APPROVERS[name]} to approve it; on an explicit yes, record "Status: approved" and "Approved by:" in the file.`,
      );
  }
}

function editPaths(args) {
  if (Array.isArray(args.replacements)) return args.replacements.map((item) => item.filePath);
  const patch = args.input ?? args.patch;
  if (typeof patch !== "string") return [args.filePath ?? args.file_path ?? args.path];
  if (/^\*\*\* Move to:/m.test(patch)) throw new Error("Use explicit edits, not moves.");
  const paths = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete)(?: File)?: (.+)$/gm)];
  if (!paths.length) throw new Error("Unrecognized patch paths.");

  return paths.map((match) => match[1]);
}

function checkArtifactEdit(context) {
  const { root, stage, folder, name } = context;
  const own = STAGES[stage].artifact;
  if (name !== own)
    throw new Error(`This agent writes only ${own}. ${name} belongs to another stage.`);
  checkInputs({ root, stage, folder });
}

function checkEdit(context) {
  const { root, stage, path } = context;
  const artifact = path.match(ARTIFACT);
  if (artifact) return checkArtifactEdit({ ...context, folder: dirname(path), name: artifact[2] });

  const code = path.match(CODE);
  if (!code)
    throw new Error(`${path} is protected. Agents edit only bots/<bot>.ts and bots/<bot>/*.ts.`);
  if (stage !== "build") throw new Error("Only Bot Build may change bot code or tests.");
  checkInputs({ root, stage, folder: `bots/${code[1]}/_workflow` });
}

function withoutCd(command, root) {
  const text = String(command ?? "").trim();
  const match = text.match(CD_PREFIX);
  const sameRoot = match ? resolve(root, match[2]) === resolve(root) : false;

  return sameRoot ? match[3].trim() : text;
}

export function availableOperations(stage) {
  return Object.keys(OPERATIONS).filter((operation) => OPERATIONS[operation].includes(stage));
}

export function commandContext(command, context) {
  const { root, stage } = context;
  const usage = `node .github/bot-workflow/run.mjs ${stage} <bot> <operation> [biome]`;
  const match = withoutCd(command, root).match(RUNNER);
  if (!match) throw new Error(`Run checks only through: ${usage}`);
  const [, requestedStage, bot, operation, biome] = match;
  if (requestedStage !== stage)
    throw new Error(`This agent runs only the ${stage} stage: ${usage}`);
  if (!OPERATIONS[operation]?.includes(stage))
    throw new Error(`Available in ${stage}: ${availableOperations(stage).join(", ")}.`);
  const folder = `bots/${bot}/_workflow`;
  if (!UNGATED.has(operation)) checkInputs({ root, stage, folder });

  return { ...context, bot, folder, operation, biome };
}

function routeTool(event, context) {
  const name = String(event.toolName ?? event.tool_name ?? "")
    .split(".")
    .at(-1);
  const supplied = event.toolArgs ?? event.tool_input ?? {};
  const args = typeof supplied === "string" ? JSON.parse(supplied) : supplied;
  if (SAFE_TOOLS.test(name)) return;
  if (TERMINAL_TOOLS.test(name)) {
    commandContext(args.command ?? args.script, context);

    return;
  }
  if (!EDIT_TOOLS.test(name)) throw new Error("Unknown tools and delegation are blocked.");

  for (const candidate of editPaths(args)) {
    const path = safePath(context.root, candidate);
    checkEdit({ ...context, path, args, candidate });
  }
}

export function decide(event, context) {
  try {
    if (!STAGES[context.stage]) throw new Error("Unknown bot workflow stage.");
    routeTool(event, context);

    return {};
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    return {
      permissionDecision: "deny",
      permissionDecisionReason: reason,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    };
  }
}

function main() {
  try {
    const event = JSON.parse(readFileSync(0, "utf8"));
    const context = { root: ROOT, stage: process.argv[2] };
    process.stdout.write(JSON.stringify(decide(event, context)));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        permissionDecision: "deny",
        permissionDecisionReason: String(error),
        continue: false,
      }),
    );
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) main();
