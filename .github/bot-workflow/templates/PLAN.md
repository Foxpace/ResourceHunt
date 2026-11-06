# Plan: <bot-id>

Status: draft
Approved by:

<!-- The agent asks the agent orchestrator and records an explicit yes here. Approval unlocks code changes
in bots/<bot-id>.ts and bots/<bot-id>/ only. -->

## Files

- `bots/<bot-id>.ts`: entry point with metadata and `act`.
- `bots/<bot-id>/_<helper>.ts`: helper (the `_` prefix hides it from bot discovery).
- `bots/<bot-id>/<name>.test.ts`: tests.

## Steps

<!-- Small steps, each with a check that would fail if the step were wrong. -->

| #   | Change | Written by | Check   | Expected |
| --- | ------ | ---------- | ------- | -------- |
| 1   |        | agent      | `check` |          |

## Core function

<!-- The function that holds the heart of the design, written by the agent: its name, inputs, output,
which design rule it implements, and the test that proves it. -->

## Done when

- [ ] `check` passes: discovered, types, structure rules, formatting, tests.
- [ ] `bench` shows zero errors for this bot.
- [ ]
