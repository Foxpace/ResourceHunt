# Resource Hunt: AI-native bot workshop

After a 5-minute intro, your team has 50 minutes to build one bot that banks the most resources on any map. You build it the AI-native way: **humans own the intent, the judgment, and every approval. Agents ask, draft, build, test, and pack.** Every stage leaves a short Markdown artifact that the next stage reads. When the timer ends you hand in your bot, and the facilitators run one tournament with every team's bot.

## Before you start

You need Node.js 23.11.1+, Yarn 4.5.3, and VS Code with GitHub Copilot Chat in agent mode.

```sh
git clone <repo-url> && cd ResourceHunt
corepack enable yarn
yarn install
yarn dev          # http://127.0.0.1:3000: watch the simple `nearest` bot play
```

Open Copilot Chat and find the five **Bot …** agents in the agent picker. Open [workshop-timer.html](workshop-timer.html) in a browser to follow the stages.

## The game in 60 seconds

- Bots move on a grid for 300 turns, one action per turn. Terrain costs 1 to 3 turns per tile.
- They `grab` resources: **ore** is worth 2 points and weighs 1, **crystal** 7 and 2, **relic** 14 and 3. A bag holds 8 weight.
- **Only banked resources score.** Cargo counts once the bot returns `home` or reaches an outpost it captured. Carried cargo scores nothing.
- The world fights back. Rivals `steal`, drones chase loaded bots, storms spill cargo, and guardians protect rich caches. Bots can `guard`, `strike`, set traps, and capture outposts.
- There are eight map types (biomes): river, valley, desert, moon, volcanic, islands, tundra, and forest maze. Your bot should work on all of them.
- Each decision must finish within 100 ms, or the bot is disabled for the match.

## Roles: rotate after Design and after Build

| Role                   | Does                                                                                    | Approves                |
| ---------------------- | --------------------------------------------------------------------------------------- | ----------------------- |
| **Intent owner**       | Decides what the bot should do and why. Keeps the idea the team's own.                  | INTENTION.md, DESIGN.md |
| **Agent orchestrator** | The only one typing to the agent. Gives context, evaluates the agent's plans and edits. | PLAN.md, BUILD.md       |
| **Risk owner**         | Asks "how do we know?", sets the success targets, and judges the results.               | REVIEW.md               |

**One computer, three people:**

- The agent addresses every question to a role, for example **"Risk owner: …"**. The person holding that role answers, and the orchestrator types it.
- Only the orchestrator types in the chat. The others talk to the orchestrator, not to the screen.
- When a draft is ready, the agent asks its approver: "Intent owner: do you approve INTENTION.md?" The approver takes the keyboard, reads the file, and answers **Approve**, **Change something**, or **Not yet**. Only an explicit yes is recorded, and the next stage stays locked until then. **Do not approve what you have not read.**
- To rotate, everyone shifts one role: the intent owner becomes the orchestrator, the orchestrator becomes the risk owner, and the risk owner becomes the intent owner.
- In a pair, one person holds two roles. Working solo, you hold all three; say out loud which one you are using.

## Timeline

| Time      | Roles | Agent                | You produce                  | Approved by  |
| --------- | ----- | -------------------- | ---------------------------- | ------------ |
| 0:00–0:05 | n/a   | Intro by facilitator | n/a                          | n/a          |
| 0:05–0:13 | set 1 | **Bot Intention**    | `INTENTION.md`               | intent owner |
| 0:13–0:25 | set 1 | **Bot Design**       | `DESIGN.md`                  | intent owner |
| 0:25–0:30 | set 2 | **Bot Plan**         | `PLAN.md`                    | orchestrator |
| 0:30–0:45 | set 2 | **Bot Build**        | your tested bot + `BUILD.md` | orchestrator |
| 0:45–0:55 | set 3 | **Bot Hand-in**      | `REVIEW.md` + hand-in zip    | risk owner   |

The timer covers the five stages (50 minutes). The tournament runs afterwards, organised by the facilitators.

Artifacts live in `bots/<your-bot-id>/_workflow/`. Your final bot is one file, `bots/<your-bot-id>.ts`. While building, the agent also writes a few practice bots, `bots/<your-bot-id>-<name>.ts`, to test yours against. Practice bots stay on disk and outside the hand-in ZIP.

## What you do and what the agent does

| Stage     | You do                                                                          | The agent does                                                                                         |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Intention | Describe the idea in your own words. Pick the twist. Choose the success target. | Points out the rules that matter, suggests bold twists, drafts the page.                               |
| Design    | Write the bot's decision order. Answer the tough situations.                    | Throws concrete game situations at your plan and tells you what won't work.                            |
| Plan      | Cut and reorder the agent's plan. Pick the risk to test first.                  | Proposes a short plan in plain words: what gets built, how it is tested, what could go wrong.          |
| Build     | Choose how the bot plays. Judge the results. Tune it, or pivot.                 | Writes and tests your bot against the simple bot, practice rivals, and unseen maps; fixes what breaks. |
| Hand-in   | Name what worries you. Give the verdict.                                        | Runs three practice tournaments, checks the bot against your targets, and packs the ZIP.               |

Every agent works two ways. **Bring your own answer** and it follows your lead, or say **"guide us"** and it offers concrete options for each role. Running out of time? Say **"wrap up"** and the agent drafts the artifact immediately, marks open points `TODO (team)`, and asks for approval. Each agent asks every role two questions per stage, batched so you answer them together. The agent handles the code and the game's details; you decide what the bot should do. **Strategy not working during Build?** Say "pivot": the agent asks each role one question and updates the intention, design, and plan in one go. Weird ideas are welcome: the tournament shows banked score, but the results also award badges for theft, traps, guardian kills, and more.

## Commands

Agents run these for you. You can run them yourself too:

```sh
node .github/bot-workflow/run.mjs <stage> <bot-id> status                    # which artifacts are draft or approved
node .github/bot-workflow/run.mjs intention <bot-id> baseline                 # typical scores of the simple `nearest` bot
node .github/bot-workflow/run.mjs build <bot-id> check                        # discovery, types, structure; formatting warnings
node .github/bot-workflow/run.mjs build <bot-id> bench                        # your bot vs 3 copies of `nearest` on 8 biomes
node .github/bot-workflow/run.mjs build <bot-id> bench forest --label before  # keep this run when comparing a later version
node .github/bot-workflow/run.mjs build <bot-id> bench --vs <bot-id>-thief,nearest,nearest   # vs a practice rival
node .github/bot-workflow/run.mjs build <bot-id> play forest                  # one match → replay in results/
node .github/bot-workflow/run.mjs build <bot-id> holdout                      # same comparison on unseen maps, once
node .github/bot-workflow/run.mjs review <bot-id> tournament                  # three practice tournaments
node .github/bot-workflow/run.mjs review <bot-id> pack                        # after approval: check and zip
```

Watch a replay with `yarn dev`, then **Import**, then choose the file in `results/`.

Benchmark and tournament evidence goes under `bots/<bot-id>/_workflow/evidence/`. Use the text report for the workshop discussion and the companion JSON for exact points by tick, round wins, seeds, and game counters.

## Submitting your bot

Your bot is ready when the risk owner has approved `REVIEW.md`. Bot Hand-in then runs `pack` to rerun the checks and write `results/<bot-id>-handin.zip` with `bots/<bot-id>.ts` and `bots/<bot-id>/`. Send that ZIP to the facilitator, or use a branch or pull request, as announced. After the ZIP is ready, the agent can ask whether to remove the team's practice bots. You can leave them on disk and finish hand-in.

---

## Facilitator notes

**Before the day**

- On a participant-like machine, run `node --test .github/bot-workflow/guard.test.mjs`. Then, in **Bot Intention**, ask the agent to edit `src/sdk.ts` (it must be blocked). Also ask **Bot Design** to start without an approved intention (it must be blocked). Check that Bot Intention asks before it records an approval. If they are not, Copilot is not running agent hooks in that setup; check that the VS Code and Copilot versions support hooks in custom agents.
- Make sure participants can clone, run `yarn install`, and run `yarn dev`.
- The hook protects files, not the terminal. Agents may run any command so they can benchmark freely; they are told not to change game source from the terminal.

**Intro (5 minutes)**

- Show one match with `yarn dev` on the projector.
- Explain the three roles and the rotation.
- Introduce the one rule that matters: _agents act up to the gate, and humans pass it._

**During the workshop**

- Start [workshop-timer.html](workshop-timer.html) on the projector when the intro ends. It shows the agent to open, the goal, and when to rotate.
- Call the rotations at Plan (0:25) and Hand-in (0:45).
- If a team falls behind, tell them to say "wrap up": a shorter approved artifact is fine. They may not skip approval.

**Tournament (after the workshop)**

1. Unzip every team's `<id>-handin.zip` at the root of one clone; it restores `bots/<id>.ts` and `bots/<id>/`. Run `yarn bots` to confirm that all are discovered.
2. Run it on the projector: `yarn dev`, set up **Tournament**, and add one copy of each team bot (up to 15). Or run `yarn tournament --bots team-a,team-b,team-c --wins 3` in the terminal.
3. Debrief with three questions. Where did the agent try to take over? Which artifact saved you time or caught a mistake? What did the hook block, and was it right?
