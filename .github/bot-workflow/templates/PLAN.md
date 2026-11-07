# Plan: <bot-id>

Status: draft
Approved by:

<!-- The agent asks the agent orchestrator and records an explicit yes here. Approval unlocks code changes
in bots/<bot-id>.ts and bots/<bot-id>-*.ts. Everything above "For the agent" is plain language for the team. -->

## What gets built

<!-- One or two lines: the bot with its full decision order first, then the special move. -->

## Heart of the bot

<!-- The one decision that makes this bot the team's own, in plain words, and the setting the team picks
in Build ("leave the storm early or late"). -->

## How we will test it

<!-- In plain words: against the simple bot on all eight maps, against practice rivals the agent writes, once
on unseen maps at the end, and the replay moment that shows the special move. -->

## Risks

<!-- Two or three, one plain line each, and which one the risk owner wants tested first. -->

## Done when

- [ ] The bot passes `check`: discovered, types, structure rules, formatting.
- [ ] No errors or timeouts for any of this team's bots.
- [ ]

## For the agent

<!-- The agent's build sheet. The team may skip it. Files: `bots/<bot-id>.ts` (final bot, one file) and
`bots/<bot-id>-<name>.ts` (practice bots, deleted at hand-in). -->

| #   | Step                                   | Check            | Expected       |
| --- | -------------------------------------- | ---------------- | -------------- |
| 1   | Final bot with the full decision order | `check`, `bench` | pass, 0 errors |

**Core function candidates:** <!-- Two pure functions, each with a small named input type, about 15
lines, the design rule it implements, and the settings the team picks in Build. -->

**Practice bots:** <!-- One or two rivals aimed at the weak spot, at most one version with one setting
changed, and the `bench` lineups. -->
