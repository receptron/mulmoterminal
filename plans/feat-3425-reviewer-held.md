# feat: tell the author when its reviewer stops on the user (#3425, part C)

## Why

Trying the dispatcher on #3420 / #3421, both codex reviewers sat on an approval prompt. Nothing said
so: the "blocked" signal (#3417) is only watched for implementers, and the author waited on its
`[requestReview]` line for the round's whole wait.

## What

- While a round waits, each poll of the reviewer's reply also asks whether the reviewer is held on
  the user (`inputHeld`: an open question or a pending permission prompt). The first time it is, the
  author is typed one `[requestReview]` line naming the reviewer's cell (`reviewerHeldMessage`). Once
  per round; not awaited, so a slow delivery does not stall the reply; dropped if the round or the
  loop is over by the time it can be delivered.
- The implementer skill says what to do with it: tell the user which cell — with `AskUserQuestion`
  when another session started it, so the dispatcher hears — and keep waiting. The round goes on by
  itself once the prompt is answered.
- Docs (en/ja config `#dir-review`) mention it.

## Verified

Specs: told once with the cell and the round still ends with its result; nothing when never held;
nothing after the loop ended while the notice waited. Mutations — never telling, telling on every
poll, ignoring the end — each turn a spec red.
