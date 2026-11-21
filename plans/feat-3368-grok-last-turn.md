# feat: a grok cell's last turn (capability matrix row 12)

The third of four agents in #3368 (copilot #3369, agy #3371). `sessionLastTurn` answered
`EMPTY_TURN` for grok, so a handoff or a round-table seat from a grok cell carried nothing.

## Where the turn is read from

`$GROK_HOME/sessions/<encodeURIComponent(cwd)>/<id>/chat_history.jsonl`. The id is the one this
server passes with `--session-id`, and conversations are partitioned by cwd, so the path itself
binds the read to the directory, as the badge reads already do. The id is checked for shape first
because it is joined into the path.

## The record shape, measured

Generated with grok 1.0.34 in a scratch tmux: a preamble turn, a step-by-step turn with a shell
command, a prompt holding the literal `</user_query>`, and a cancelled turn. Kept as
`test/fixtures/grok/chat_history-1.0.34.jsonl`, with context and tool output blanked. A 0.2-era
conversation on this machine has the same shape and reads correctly.

```
user         [{type:"text", text:"<user_query>\n…\n</user_query>"}], prompt_index N
user         … synthetic_reason "system_reminder"    context grok injects
reasoning    content null
assistant    "I'll read…" + tool_calls                a preamble
tool_result  "1→apple\n"
assistant    "…", no tool_calls                       the answer
```

## Decisions

- **The user's prompts are the `user` messages with a `prompt_index`.** The others are context grok
  adds (the workspace header, skill lists, MCP servers).
- **The answer is the last `assistant` message with no tool calls and some text.** A cancelled turn
  writes nothing after its last completed step, so it has no answer and the reader falls back.
- **`<user_query>` unwrapping is shared with cursor.** Grok does not escape the marker either
  (measured), so it needs the same first-open-to-last-close rule. The function moved verbatim from
  `cursor-last-turn.ts` to `server/agents/user-query.ts`; its tests moved with it.
- **No push read.** Grok drives no finished push today (capability matrix row 3), so there is no
  current-turn read to add.

## Not in scope

- The conversation view (row 25) for grok (#1822).
