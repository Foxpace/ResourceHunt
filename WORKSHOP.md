# Resource Hunt: AI-native bot workshop

Your team has 50 minutes to build a bot that banks the most resources on any map. Your team makes the decisions and approves each stage. The agents ask questions, draft the plan, build and test the bot, and pack it for hand-in. Each stage leaves a short Markdown artifact for the next agent. After hand-in, the facilitators run a tournament with every team's bot.

## Before you start

Set up and run the preflight before the session. Use the Dev Container with Docker or Podman, or use the native setup if you already have Node. Both setups need Git, VS Code, GitHub Copilot Chat, and a GitHub account with Copilot access. Open the Command Palette with `Ctrl+Shift+P` on Windows/Linux or `Cmd+Shift+P` on macOS. Replace `<repo-url>` with this repository's clone URL.

### Container setup

Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers). VS Code stays on your computer. The game, Node, Yarn, and workshop commands run in the container.

#### Docker

- **Windows with WSL 2.** Start Docker Desktop with its WSL 2 backend. Enable integration for your Linux distribution under **Settings > Resources > WSL Integration** and install VS Code's **WSL** extension. Clone from the WSL terminal into a directory under `~/` for faster file access and reliable file watching. If you prefer a Windows checkout, clone and open it from PowerShell with Docker Desktop running.
- **macOS.** Install and start Docker Desktop for your Mac's processor.
- **Linux.** Start Docker Engine and make sure your user can run Docker commands without `sudo`.

Run `docker info` in the terminal you will use for the checkout. It should show a **Server** section.

#### Podman

1. Install Podman 5 or later. On Windows and macOS, create and start a machine in Podman Desktop or run the commands below in PowerShell or your macOS terminal. Skip `init` if you already have a machine. See [Podman machine setup](https://podman-desktop.io/docs/podman/creating-a-podman-machine).

   ```sh
   podman machine init
   podman machine start
   ```

   On Linux, install Podman from your distribution and run it directly.

2. Run `podman info` and check that it succeeds. If you installed Podman on Windows, use PowerShell and a Windows checkout for the workshop.
3. In VS Code, open **Preferences: Open User Settings (JSON)** and set `dev.containers.dockerPath` to `podman`. If VS Code cannot find it, use the full path to the Podman executable. See [VS Code's Podman setup](https://code.visualstudio.com/remote/advancedcontainers/docker-options#_podman).

If VS Code reports `Permission denied` under `/vscode/vscode-server` with an existing Podman cache, set `"dev.containers.cacheVolume": false` in VS Code User Settings and run **Dev Containers: Rebuild Container**. VS Code will install its server inside the rebuilt container instead of using the shared cache.

#### Open the workshop in a container

1. Clone and open the repository in the terminal where you verified Docker or Podman.

   ```sh
   git clone <repo-url> ResourceHunt
   cd ResourceHunt
   code .
   ```

   If `code` is unavailable, use **File > Open Folder** or **WSL: Open Folder in WSL** for a WSL checkout.

2. Trust the workspace and choose **Dev Containers: Reopen in Container**. Wait for VS Code to build the Node 24 image, install the dependencies, and enable Copilot Chat in the container.
3. Sign in to Copilot if prompted and open a new terminal in the container. If using Podman, run `test -w bots && test -w node_modules` to check write access. Then run the [preflight](#preflight).

To leave, choose **Dev Containers: Reopen Folder Locally**. Bot files and hand-in ZIPs stay in the checkout. Dependencies stay in a container volume.

The [Dockerfile](Dockerfile) pins the Node 24 Bookworm image for Intel/AMD and Apple Silicon. After updating the image pin, choose **Dev Containers: Rebuild Container**.

#### Fix a Yarn certificate error on Windows

If `yarn install --immutable` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, an antivirus or workplace proxy may be inspecting HTTPS. Windows may trust the certificate it uses while the Linux container has a separate trust store. Keep the dev container running and open PowerShell on Windows. Run these commands with `docker`, or replace `docker` with `podman` if you used Podman to open the workspace.

1. List the running dev containers and enter the ID for Resource Hunt. Check the issuer of the certificate presented to the container.

   ```powershell
   docker ps --filter label=devcontainer.local_folder
   $containerId = Read-Host 'Resource Hunt container ID'
   docker exec $containerId sh -c 'openssl s_client -connect repo.yarnpkg.com:443 -servername repo.yarnpkg.com </dev/null 2>/dev/null | openssl x509 -noout -issuer'
   ```

2. Find the matching root certificate in the Windows trusted root stores. For Avast, look for `Avast Web/Mail Shield Root`. Use the root for the antivirus or proxy you recognize, and check with your IT team if you are unsure which one to use.

   ```powershell
   Get-ChildItem Cert:\CurrentUser\Root, Cert:\LocalMachine\Root |
     Format-Table Subject, Thumbprint, NotAfter -AutoSize
   $thumbprint = Read-Host 'Thumbprint of the trusted root certificate'
   $certificate = Get-Item "Cert:\LocalMachine\Root\$thumbprint" -ErrorAction SilentlyContinue
   if (-not $certificate) { $certificate = Get-Item "Cert:\CurrentUser\Root\$thumbprint" -ErrorAction Stop }
   ```

3. Copy the public root certificate into the container and retry Yarn with Node's system trust store enabled.

   ```powershell
   @(
     '-----BEGIN CERTIFICATE-----'
     [Convert]::ToBase64String($certificate.RawData, 'InsertLineBreaks')
     '-----END CERTIFICATE-----'
   ) | docker exec -i --user root $containerId sh -c 'tr -d "\r" > /usr/local/share/ca-certificates/workshop-https-root.crt && update-ca-certificates'

   docker exec --user node --env NODE_USE_SYSTEM_CA=1 $containerId yarn install --immutable
   ```

After the install succeeds, continue with the [preflight](#preflight) in the VS Code terminal. The certificate is stored in the current container. Repeat these steps with the new container ID if you rebuild and see the same error. See [Docker's guide to CA certificates](https://docs.docker.com/engine/network/ca-certs/) and [Node's system CA documentation](https://nodejs.org/learn/http/enterprise-network-configuration).

### Native Node

Use Node.js 24 LTS for a new native setup. The game also supports the Node 23.11.1 version pinned in `.nvmrc`. Corepack selects Yarn 4.5.3. Run these commands in PowerShell, WSL, or a Linux/macOS terminal. If you use WSL, install Node in the Linux distribution and open the checkout with VS Code's WSL extension.

```sh
git clone <repo-url> ResourceHunt
cd ResourceHunt
corepack enable yarn
yarn install --immutable
```

If `corepack` is missing, run `npm install --global corepack`, then retry `corepack enable yarn`. If PowerShell blocks `.ps1` launchers, use `npm.cmd`, `corepack.cmd`, and `yarn.cmd`.

Open the checkout in VS Code, trust the workspace, and sign in to Copilot.

### Preflight

1. In the VS Code terminal, run `yarn bots`. You should see `nearest` (Scout).
2. Run `yarn dev`, open [127.0.0.1:3000](http://127.0.0.1:3000), and start a match with Scout. In a Dev Container, open the game from VS Code's **Ports** tab and check that both the container and local port are 3000.
3. In a fresh chat, select **Bot Design** and ask it to start with an unused bot ID. It should send you to **Bot Intention** without writing a design. Then open a new chat with **Bot Intention** for the workshop.

Stop the server with `Ctrl+C`. If port 3000 is busy, use `PORT=3100 yarn dev` in a container, WSL, Linux, or macOS shell. In PowerShell, use `$env:PORT = "3100"; yarn dev` and clear it afterwards with `Remove-Item Env:PORT`. In a Dev Container, forward 3100 and set the local port to 3100 as well. The game checks that the browser's port matches the server's port.

Open [workshop-timer.html](workshop-timer.html) in a browser when the timed stages begin.

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

| Time      | Roles | Agent             | You produce                  | Approved by  |
| --------- | ----- | ----------------- | ---------------------------- | ------------ |
| 0:00–0:10 | set 1 | **Bot Intention** | `INTENTION.md`               | intent owner |
| 0:10–0:20 | set 1 | **Bot Design**    | `DESIGN.md`                  | intent owner |
| 0:20–0:25 | set 2 | **Bot Plan**      | `PLAN.md`                    | orchestrator |
| 0:25–0:45 | set 2 | **Bot Build**     | your tested bot + `BUILD.md` | orchestrator |
| 0:45–0:50 | set 3 | **Bot Hand-in**   | `REVIEW.md` + hand-in zip    | risk owner   |

Start the timer after the facilitator's introduction. The tournament follows hand-in.

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
