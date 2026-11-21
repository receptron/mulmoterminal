# feat: a copilot cell's last turn (capability matrix row 12)

The first of four agents in #3368. `sessionLastTurn` answered `EMPTY_TURN` for copilot, so a handoff
or a round-table seat from a copilot cell carried nothing, and its finished-turn push had no reply.

## Where the turn is read from

`$COPILOT_HOME/session-state/<id>/events.jsonl`, **not** the `turns` table the conversation view
(row 25) reads. Measured against copilot 1.0.83 in a live session: a turn's row appears in `turns`
only when the NEXT prompt is submitted. The newest finished answer is never in the table, so reading
the last turn from it hands another cell the previous answer as this one's.

The session id is the one this server passes with `--session-id`, so no mapping is needed. The read
is bound to the directory first through `copilotSessionExistsForCwd` (#2132), which also stops an id
like `../x` from naming a path.

## The record shape, measured

Generated with the real CLI in a scratch tmux: a preamble turn, a plain one, a step-by-step turn with
two commentaries and a shell command, a subagent turn, and an interrupted one. Kept, cut down to the
fields read, as `test/fixtures/copilot/events-1.0.83.jsonl`.

```
{"type":"user.message","data":{"content":"…"}}
{"type":"assistant.message","data":{"phase":"commentary","content":"I'll read…","toolRequests":[…]}}
{"type":"assistant.message","data":{"phase":"final_answer","content":"…","toolRequests":[]}}
{"type":"abort","data":{"reason":"user_initiated"}}
```

## Decisions

- **The answer is the record copilot labels `final_answer`** with no tool requests. No inferring
  which prose ends the turn (#1487). A record without the label is not an answer.
- **Subagent records are skipped.** A subagent's prompt is a `user.message` and its result a
  `final_answer` in the same file; every record it writes has a top-level `agentId`, the main
  agent's never do. Without the skip, the subagent's instructions are quoted as the user's prompt.
- **Two reads.** `copilotLastTurnFromEvents` falls back to the previous complete exchange (what a
  handoff wants, as for claude and cursor). `copilotCurrentTurnReplyFromEvents` answers null when the
  newest prompt has no answer, and the push uses it (#1650): an interrupted turn must not be
  announced with the previous answer. The `agentStop` hook fires after the final answer is written
  (measured in sessions spawned with the hook), so the push read does not race it.

## Not in scope

- The conversation view still reads `turns`, and so lags one turn on the phone and in the pane.
  Separate change.
- The prompts pane (`sessionPrompts`) stays claude-only.
