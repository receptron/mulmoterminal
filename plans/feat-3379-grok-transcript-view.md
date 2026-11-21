# feat: the conversation view for a grok session (capability matrix row 25)

The first of #3379's two agents. Grok sat in `UNREAD_SOURCES`, so its sessions showed "this host
cannot read this conversation" on the phone and in the Conversation pane. #1822 deferred it because
no grok session existed to measure; #3368 measured one (`test/fixtures/grok/chat_history-1.0.34.jsonl`,
grok 1.0.34).

## Source

A file source, `transcript-view-grok.ts`, located at
`$GROK_HOME/sessions/<encodeURIComponent(cwd)>/<id>/chat_history.jsonl`. The session key is grok's
conversation id (`--session-id`), so there is no mapping, and the cwd partition binds the read to the
directory. The id's shape is checked before it is joined into the path. It is asked after codex and
before cursor: its locate is one path join.

## Rendering

| message | rows |
|---|---|
| `user` with `prompt_index` | opens a turn: the unwrapped prompt (`userQueryText`), then any non-text part as `unknown` |
| `user` without it | nothing — context grok injects (`synthetic_reason`) |
| `assistant` | its prose, then one call row per `tool_calls` entry (`name` + head of `arguments`) |
| `tool_result` | a tool row, capped by `toolResultRow` like every agent's |
| `system`, `reasoning` | nothing |
| anything else | an `unknown` row naming its type |

Grok's messages carry no timestamp, so a turn's `at` is null.

## Tests

- `transcript-view-grok.spec.ts`: the fixture, folded whole; prompt detection; each row kind; the
  unknown-row cases.
- `transcript-view-read.spec.ts`: grok moves from "not-supported" to "none when nothing is written";
  a planted conversation is read; one filed under another cwd is not. The default-store-list test no
  longer plants a grok session (grok has a reader now); it swaps production's antigravity probe for
  the duration of the test instead.
- The fixture keeps the tool calls' `arguments` (paths rewritten), which the call rows need.
