# Resource Hunt bot workflow

This folder runs the workshop's AI-native workflow: five Copilot agents, one Markdown artifact per stage, and a hook that stops each stage until its inputs are approved. Participants start with [WORKSHOP.md](../../WORKSHOP.md). All agents share the rules in [bot-development.instructions.md](../instructions/bot-development.instructions.md).

It follows [the AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook):

| Playbook                   | Here                            |
| -------------------------- | ------------------------------- |
| `intent.md`                | `INTENTION.md` (Bot Intention)  |
| `spec.md`                  | `DESIGN.md` (Bot Design)        |
| `plan.md` before any code  | `PLAN.md` (Bot Plan)            |
| self-verification output   | `BUILD.md` + `evidence/`        |
| `REVIEW.md`, fresh context | `REVIEW.md` (Bot Test & Review) |
| hooks as approval gates    | `guard.mjs`                     |

## Design choices

- **The team leads.** Agents ask for the team's answer before they offer facts, risks, or one alternative. Sections marked ✍️ in the templates are copied from the team, never invented.
- **Humans decide, agents write.** The team supplies the idea, the decision order, the success targets, the design rule for the core function, and the review verdict. The agents write all code.
- **Short by default.** Replies stay at about 100 words or fewer, and each artifact is about one page.
- **Ask, then record.** Each artifact starts with `Status: draft` and an empty `Approved by:` line. The agent asks the approving role with the question tool, and only on an explicit yes does it write `Status: approved` and `Approved by: <role>, in chat`. Humans may also edit those lines themselves. Asking is an instruction; the stage gate is the deterministic part.

## What the hook enforces

Each agent runs `node .github/bot-workflow/guard.mjs <stage>` before every tool call. The hook:

- Requires the upstream artifacts to be approved, with both the status and a signed `Approved by:` line, before a stage writes anything: Design needs INTENTION, Plan needs DESIGN, Build needs PLAN, Review needs BUILD.
- Lets each agent write only its own artifact in `bots/<bot-id>/_workflow/`. Only Bot Build may write code, and only in `bots/<bot-id>.ts` and `bots/<bot-id>/`.
- Allows terminal commands only as `node .github/bot-workflow/run.mjs <stage> <bot-id> <operation> [biome]`, with operations limited per stage. The holdout check runs only in review, so the build never sees those maps.
- Blocks unknown tools and subagent delegation.

The [shared rules](../instructions/bot-development.instructions.md#running-things) list the runner operations. Evidence goes to `bots/<bot-id>/_workflow/evidence/`, and replays go to `results/`, which git ignores.

## Maintaining

- Test the guard with `node --test .github/bot-workflow/guard.test.mjs`.
- Keep the agent frontmatter stable: tool list, hook command, and handoffs. The tests check that every handoff names an existing agent.
- These are local guardrails, not a sandbox. Hooks can be disabled in user settings, and humans can edit anything. Bot code runs with normal Node permissions, so run only trusted bots.
