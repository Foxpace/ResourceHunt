# Review: <bot-id>

Status: draft
Approved by:

<!-- Bot Hand-in asks the risk owner and records an explicit yes here. Approval means "this bot enters the
tournament" and unlocks `pack`. The agent writes evidence and findings; the risk owner writes the verdict. -->

## What the risk owner wanted proven ✍️

-

## Practice tournaments

<!-- Copied from `evidence/review-tournament.txt`: three tournaments, first to three round wins. -->

| Tournament | Place | Round wins | Score | Errors | Winner |
| ---------- | ----- | ---------- | ----- | ------ | ------ |

## Acceptance results

<!-- One row per check in INTENTION.md, using Build's `holdout` and the tournaments. "Not verified" is a
valid, honest result. -->

| ID  | Target | Measured | Pass? | Evidence |
| --- | ------ | -------- | ----- | -------- |

## Findings

<!-- At most three, most severe first, including mismatches between the code and DESIGN.md's decision
order. "Goes back to" names the stage that should fix it. -->

| Severity | Finding | Evidence | Goes back to |
| -------- | ------- | -------- | ------------ |

## Verdict ✍️

<!-- Risk owner, one or two sentences: does the bot enter the tournament, and what is the biggest
remaining risk? -->

## Hand-in

- [ ] Practice bots removed and `check` passes (`pack`)
- [ ] `results/<bot-id>-handin.zip` with `bots/<bot-id>.ts` and `bots/<bot-id>/`
- [ ] Zip sent to the facilitator
