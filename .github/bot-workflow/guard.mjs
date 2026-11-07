import { lstatSync, readFileSync, readdirSync } from "node:fs";
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
export const SLUG = /^[a-z][a-z0-9-]{0,47}$/;
const ARTIFACTS = new Set(Object.values(STAGES).map((stage) => stage.artifact));
const PIVOT_ARTIFACTS = new Set(STAGES.build.needs);
const READ_ONLY_BOTS = new Set(["bots/nearest.ts"]);
const WORKFLOW_FILE = /^bots\/([a-z][a-z0-9-]{0,47})\/_workflow\/(.+)$/;
const APPROVED_STATUS = /^[\W_]*status[\W_]*:[\W_]*approved\b/im;
const SIGNATURE = /^[\W_]*approved by[\W_]*:[ \t*_]*[^\s<*_]/im;
const EDIT_TOOLS =
  /^(apply_patch|create_file|create|create_directory|replace_string_in_file|multi_replace_string_in_file|insert_edit_into_file|edit_notebook_file|vscode_renameSymbol|str_replace_editor|edit|write)$/i;

export function isApproved(content) {
  return APPROVED_STATUS.test(content) && SIGNATURE.test(content);
}

export function safePath(root, candidate) {
  if (typeof candidate !== "string") throw new Error("Missing file path.");
  const absolute = resolve(root, candidate);
  const local = relative(root, absolute).split(sep).join("/");
  if (!local.startsWith("bots/"))
    throw new Error(`${local} is game source and read-only. Agents write only in bots/.`);

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
  return Object.keys(STAGES).find((stage) => STAGES[stage].artifact === name);
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

/** The team owning a bot file: bots/<team>.ts, bots/<team>-<name>.ts, or bots/<team>/... */
export function teamOf(root, path) {
  const name = path.split("/")[1].replace(/\.ts$/, "");
  const teams = readdirSync(resolve(root, "bots"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((team) => hasWorkflow(root, team));
  const owners = teams.filter((team) => name === team || name.startsWith(`${team}-`));

  return owners.sort((a, b) => b.length - a.length)[0] ?? null;
}

function hasWorkflow(root, team) {
  const folder = resolve(root, "bots", team, "_workflow");

  return lstatSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function editPaths(args) {
  if (Array.isArray(args.replacements)) return args.replacements.map((item) => item.filePath);
  const patch = args.input ?? args.patch;
  if (typeof patch !== "string")
    return [args.filePath ?? args.file_path ?? args.path ?? args.dirPath ?? args.uri];
  if (/^\*\*\* Move to:/m.test(patch)) throw new Error("Use explicit edits, not moves.");
  const paths = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete)(?: File)?: (.+)$/gm)];
  if (!paths.length) throw new Error("Unrecognized patch paths.");

  return paths.map((match) => match[1]);
}

function checkWorkflowEdit(context) {
  const { stage, name } = context;
  const own = STAGES[stage].artifact;
  const pivot = stage === "build" && PIVOT_ARTIFACTS.has(name);
  if (pivot) return;
  const otherStage = ARTIFACTS.has(name) && name !== own;
  if (otherStage)
    throw new Error(
      `This agent writes only ${own}. ${name} belongs to the ${stageOf(name)} stage.`,
    );
  checkInputs(context);
}

function checkCodeEdit(context) {
  const { root, stage, path } = context;
  if (stage !== "build")
    throw new Error("Only Bot Build writes .ts files, once the plan is approved.");
  const team = teamOf(root, path);
  if (!team)
    throw new Error(
      `${path} has no team. Name bot files bots/<team-id>.ts or bots/<team-id>-<name>.ts.`,
    );
  checkInputs({ root, stage, folder: `bots/${team}/_workflow` });
}

function checkEdit(context) {
  const { path } = context;
  if (READ_ONLY_BOTS.has(path))
    throw new Error(`${path} is the shared baseline. Copy it into a new bot file instead.`);

  const workflow = path.match(WORKFLOW_FILE);
  if (workflow) {
    const folder = `bots/${workflow[1]}/_workflow`;

    return checkWorkflowEdit({ ...context, folder, name: workflow[2] });
  }
  if (path.endsWith(".ts")) checkCodeEdit(context);
}

function routeTool(event, context) {
  const name = String(event.toolName ?? event.tool_name ?? "")
    .split(".")
    .at(-1);
  if (!EDIT_TOOLS.test(name)) return;

  const supplied = event.toolArgs ?? event.tool_input ?? {};
  const args = typeof supplied === "string" ? JSON.parse(supplied) : supplied;
  for (const candidate of editPaths(args)) {
    const path = safePath(context.root, String(candidate ?? "").replace(/^file:\/\//, ""));
    checkEdit({ ...context, path });
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
