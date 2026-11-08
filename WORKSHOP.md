# Resource Hunt: AI-native bot workshop

After a 5-minute intro, your team has 50 minutes to build one bot that banks the most resources on any map. You build it the AI-native way: **humans own the intent, the judgment, and every approval. Agents ask, draft, build, test, and pack.** Every stage leaves a short Markdown artifact that the next stage reads. When the timer ends you hand in your bot, and the facilitators run one tournament with every team's bot.

## Before you start

Choose a container or native Node setup. Both require VS Code, GitHub Copilot Chat, a Copilot account, and a trusted workspace. Open the Command Palette with `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS). Replace `<repo-url>` with this repository's clone URL.

### Container setup

Use this setup to run VS Code, Copilot, Node, Yarn, and the game in one container; no host Node or Yarn is needed. Install Git, VS Code, [**Dev Containers**](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers), and **GitHub Copilot Chat**, then prepare one engine:

| Host OS | Docker                                                                                                                                                                 | Podman                                                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Windows | Install Docker Desktop with the WSL 2 backend, then start Docker Desktop.                                                                                              | Install Podman Desktop and its WSL 2 prerequisites. Create and start a Podman machine using the app or the commands below. |
| Linux   | Install Docker Engine using your distribution's instructions, start it, and configure access for your user without `sudo`. Docker Desktop for Linux is another option. | Install Podman using your distribution's package manager. Use rootless Podman directly; no Podman machine is needed.       |
| macOS   | Install and start Docker Desktop. Choose the installer for your Mac's Intel or Apple Silicon processor.                                                                | Install Podman Desktop or the Podman CLI. Create and start a Podman machine using the app or the commands below.           |

For Podman on Windows/macOS, run these in PowerShell or Terminal; skip `init` if a machine already exists:

```sh
podman machine init
podman machine start
```

1. In a host terminal, verify the engine with `docker info` or `podman info`; fix connection or permission errors first.
2. On Windows, open a regular checkout from PowerShell. For WSL, install VS Code's **WSL** extension and use **WSL: Open Folder in WSL**. Enable Docker Desktop's WSL integration and keep the checkout under `~/`, not `/mnt/c/`. With Windows-installed Podman, use Windows VS Code unless Podman is configured in WSL.
3. For Podman only, open **Preferences: Open User Settings (JSON)** and add:

   ```json
   "dev.containers.dockerPath": "podman"
   ```

   If needed, use Podman's absolute path. This is a VS Code User setting, not a workspace setting.

4. Clone the repository in PowerShell, a Linux/macOS terminal, or WSL:

   ```sh
   git clone <repo-url> ResourceHunt
   cd ResourceHunt
   ```

   Open the folder in VS Code with **File > Open Folder** or `code .`. On macOS, install the `code` command through **Shell Command: Install 'code' command in PATH** if needed.

5. Trust the workspace and run **Dev Containers: Reopen in Container**. The first build downloads Node 24, installs Copilot Chat, enables the pinned Yarn version, and installs dependencies; wait for setup to finish.
6. Sign in to Copilot and enable Chat in the container if prompted. Select **Bot Intention** in Chat; this repository provides all five **Bot ...** agents and their skills.
7. Open **Terminal: New Terminal** and run all workshop commands in the container's Linux shell:

   ```sh
   node --version
   yarn --version
   yarn bots
   yarn dev
   ```

8. Open port 3000 from VS Code's **Ports** tab. If occupied, stop the server, run `PORT=3100 yarn dev`, forward port 3100, and open its forwarded localhost address; the server rejects untrusted Host headers.
9. Run the workshop with a **Bot ...** agent. Commands and approval hooks run in the container; bot files, workflow artifacts, and ZIPs in `results/` stay in the checkout.
10. To leave, run **Dev Containers: Reopen Folder Locally**. Your checkout and results remain on your computer.

Stop the server with `Ctrl+C`; return with **Dev Containers: Reopen in Container**. Source stays in the checkout and dependencies in a container volume.

The [container configuration](.devcontainer/devcontainer.json) pins the Node 24 Bookworm image by a multi-architecture SHA-256 digest for Intel/AMD and Apple Silicon. Digest pins do not update automatically; after changing the tag and digest, run **Dev Containers: Rebuild Container**.

### Native Node

Install Git and Node.js 24 LTS (the game requires 23.11.1+). Corepack selects the pinned Yarn 4.5.3. Run these commands in PowerShell or a Linux/macOS terminal:

```sh
git clone <repo-url> ResourceHunt
cd ResourceHunt
corepack enable yarn
yarn install
yarn dev
```

If `corepack` is missing, run `npm install --global corepack`, then retry `corepack enable yarn`. If PowerShell blocks `.ps1` launchers, use `npm.cmd`, `corepack.cmd`, and `yarn.cmd` instead of changing the execution policy.

Open [localhost:3000](http://127.0.0.1:3000) and stop the server with `Ctrl+C`. To use port 3100, run `PORT=3100 yarn dev` on Linux/macOS or `$env:PORT = "3100"; yarn dev` in PowerShell; clear the Windows override with `Remove-Item Env:PORT`.

In Copilot Chat, select one of the five **Bot …** agents. Open [workshop-timer.html](workshop-timer.html) in a browser for the stage timer.

## The game in 60 seconds

- Bots get 300 turns, one action per turn; terrain takes 1-3 turns per tile.
- `grab` resources: **ore** is 2 points/1 weight, **crystal** 7/2, and **relic** 14/3. Bags hold 8 weight.
- **Only banked resources score.** Cargo banks at `home` or a captured outpost; carried cargo scores nothing.
- Rivals can `steal`; drones chase loaded bots, storms spill cargo, and guardians protect rich caches. Bots can `guard`, `strike`, set traps, and capture outposts.
- Bots should work across all eight biomes: river, valley, desert, moon, volcanic, islands, tundra, and forest maze.
- Each decision has a 100 ms limit; exceeding it disables the bot for that match.

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

- On a participant-like machine, run `node --test .github/bot-workflow/guard.test.mjs` in the VS Code terminal. Then, in **Bot Intention**, ask the agent to edit `src/sdk.ts` (it must be blocked). Also ask **Bot Design** to start without an approved intention (it must be blocked). Check that Bot Intention asks before it records an approval. If they are not, Copilot is not running agent hooks in that setup; check that the VS Code and Copilot versions support hooks in custom agents. Repeat this check in the exact environment and session type participants will use. Hook timeouts can fall through to normal permissions; hooks are not a security sandbox.
- Make sure participants can clone, start their chosen environment, and run the game before the session.
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
