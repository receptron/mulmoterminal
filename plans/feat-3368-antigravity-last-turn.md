# feat: an Antigravity cell's last turn (capability matrix row 12)

The second of four agents in #3368 (copilot is #3369). `sessionLastTurn` answered `EMPTY_TURN` for
agy, so a handoff or a round-table seat from an agy cell carried nothing, and its finished-turn push
had no reply.

## Where the turn is read from

`$ANTIGRAVITY_HOME/brain/<conversationId>/.system_generated/logs/transcript.jsonl`, the same file the
title and the model badge already read. agy mints the conversation id, so the session key goes
through `antigravityConversations` and falls back to the key itself, exactly as the codex reader and
the agy badge do. #2132 decided these readers do not re-check the cwd.

## The record shape, measured

Generated with agy 1.3.5 in a scratch tmux: a preamble turn, a step-by-step turn with two
commentaries and a shell command, and an interrupt. Kept as
`test/fixtures/antigravity/transcript-1.3.5.jsonl`, with tool outputs blanked and paths rewritten.

```
USER_INPUT        content "<USER_REQUEST>\n…\n</USER_REQUEST>\n<ADDITIONAL_METADATA>…"
PLANNER_RESPONSE  content "I will read…" + tool_calls     a preamble
PLANNER_RESPONSE  content null + tool_calls               a call with nothing said
GENERIC / VIEW_FILE / …                                   a tool's output
PLANNER_RESPONSE  content "…", no tool_calls              the answer
PLANNER_RESPONSE  content null, no tool_calls             what an interrupt leaves
```

Each step is written whole once it is DONE; no partial step was seen while a turn ran.

## Decisions

- **The answer is the last DONE `PLANNER_RESPONSE` with no tool calls and some text.** The text
  condition is what keeps an interrupt from reading as a turn that ended with an empty answer.
- **The prompt is unwrapped with the existing title code** (`antigravityPromptText`, now exported),
  so the two cannot disagree about what the user typed.
- **Two reads**, as for copilot: the handoff falls back to the previous complete exchange; the push
  uses `antigravityCurrentTurnReply`, which never does (#1650).

## Not in scope

- Subagents: none were produced, so nothing is known about how agy records one.
- The conversation view (row 25) for agy (#1822).
