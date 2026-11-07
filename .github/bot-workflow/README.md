# Resource Hunt bot workflow

This folder runs the workshop's AI-native workflow: five Copilot agents, one Markdown artifact per stage, and a minimal hook that protects the game and stops each stage until its inputs are approved. Participants start with [WORKSHOP.md](../../WORKSHOP.md); the stage minutes match [workshop-timer.html](../../workshop-timer.html). All agents share the rules in [bot-development.instructions.md](../instructions/bot-development.instructions.md) and load three skills for repeatable work:

| Skill                                                                   | Used for                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| [resource-hunt-strategies](../skills/resource-hunt-strategies/SKILL.md) | Grounded mechanics, numbers, archetypes, stress scenarios |
| [bot-forge](../skills/bot-forge/SKILL.md)                               | Writing the final bot and practice bots                   |
| [bot-arena](../skills/bot-arena/SKILL.md)                               | Benchmarks, tournaments, replays, packing the hand-in     |

It follows [the AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook):

| Playbook                   | Here                           |
| -------------------------- | ------------------------------ |
| `intent.md`                | `INTENTION.md` (Bot Intention) |
| `spec.md`                  | `DESIGN.md` (Bot Design)       |
| `plan.md` before any code  | `PLAN.md` (Bot Plan)           |
| self-verification output   | `BUILD.md` + `evidence/`       |
| `REVIEW.md`, fresh context | `REVIEW.md` (Bot Hand-in)      |
| hooks as approval gates    | `guard.mjs`                    |
| skills as knowledge        | `.github/skills/`              |

## Design choices

- **The team leads.** Agents ask for the team's answer first, then build on it with grounded, often wild, options. Sections marked ✍️ in the templates are copied from the team, never invented.
- **Humans decide, agents write.** The team supplies the idea, the decision order, the settings in plain words, the choice of the best version, and the verdict. Agents write and test all code, including practice bots to benchmark against.
- **Coach, not engineer.** In chat, agents say what the bot will do in plain words and offer relative options ("bank when mostly full"). Helper names, files, and numbers stay in artifacts and code. The simple bot's scores are measured once and written into the shared rules, so no stage waits for `baseline`.
- **Pivot, don't restart.** If the strategy fails in Build, one question per role updates INTENTION.md, DESIGN.md, and PLAN.md together, and the team re-approves them.
- **Every role speaks, briefly.** Each agent asks each role exactly twice, batched into two or three question calls, plus the approval. "guide us" switches to option menus; "wrap up" drafts immediately.
- **Ask, then record.** Each artifact starts with `Status: draft` and an empty `Approved by:` line. The agent asks the approving role, and only on an explicit yes does it write `Status: approved` and `Approved by: <role>, in chat`.
- **The game is the test suite.** The final bot is one file with no unit tests. `check`, `bench`, `holdout`, replays, and three practice tournaments prove it.

## What the hook enforces

Each agent runs `node .github/bot-workflow/guard.mjs <stage>` before every tool call. It inspects only file edits:

- Writes outside `bots/`, symlinked paths, and `bots/nearest.ts` are blocked.
- A stage writes nothing until its upstream artifacts exist with an approved status and a signed `Approved by:` line.
- Each agent writes only its own stage artifact; other notes and evidence in `_workflow/` are fine.
- During a pivot, Bot Build may also rewrite INTENTION.md, DESIGN.md, and PLAN.md. Its code stays blocked until all three are approved again.
- `.ts` files are written only by Bot Build, and only as `bots/<team>.ts`, `bots/<team>-<name>.ts`, or inside `bots/<team>/`, where `bots/<team>/_workflow/` exists. Bot Hand-in writes no code.

Everything else is allowed: reading, searching, the Explore subagent, and any terminal command. The runner keeps two nudges: `holdout` runs only in Build, once at the end, and `pack` (delete practice bots, `check`, zip to `results/<bot-id>-handin.zip`) runs only after REVIEW.md is approved. Evidence goes to `bots/<bot-id>/_workflow/evidence/`, and replays go to `results/`, which git ignores.

## Maintaining

- Test the guard with `node --test .github/bot-workflow/guard.test.mjs`. It also checks that every agent loads the shared rules, asks each role equally often, and matches the timer's names and minutes.
- Keep the agent frontmatter stable: tool list, hook command, and handoffs. The tests check that every handoff names an existing agent.
- These are local guardrails, not a sandbox. The terminal is unrestricted, hooks can be disabled in user settings, and humans can edit anything. Bot code runs with normal Node permissions, so run only trusted bots.
