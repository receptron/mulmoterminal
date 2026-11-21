# feat: the conversation view for an Antigravity session (capability matrix row 25)

The second of #3379's two agents (grok was #3381). Antigravity sat in `UNREAD_SOURCES`, so its
sessions said the host cannot read the conversation. #3368 measured agy 1.3.5
(`test/fixtures/antigravity/transcript-1.3.5.jsonl`). After this, only muse is left unread (#3375).

## Source

A file source, `transcript-view-antigravity.ts`, at
`$ANTIGRAVITY_HOME/brain/<conversationId>/.system_generated/logs/transcript.jsonl`. agy mints the
conversation id, so the key is resolved through `antigravityConversations` (awaiting its hydration)
with the key itself as the fallback, the same way the last-turn reader and the badge do it. The
resolved id is checked for shape (`isAntigravityConversationId`, newly exported) before it is joined
into the path. That check is defence in depth: `sessionTranscriptView` already refuses a key that is
not a session id, so the public entry point cannot reach it. Asked after grok and before cursor.

## Rendering

| step | rows |
|---|---|
| `USER_INPUT` | opens a turn: the unwrapped prompt (`antigravityPromptText`), `at` = its `created_at` |
| `PLANNER_RESPONSE` | its prose, then one call row per `tool_calls` entry: `name` + head of `args` with each value JSON-decoded one level |
| a MODEL step with text (GENERIC, VIEW_FILE, GREP_SEARCH, …) | a tool row without the leading `Created At:` / `Completed At:` lines, capped by `toolResultRow` |
| SYSTEM (CONVERSATION_HISTORY, CHECKPOINT), a MODEL step with no content, an interrupt's empty response | nothing |
| anything else | an `unknown` row naming its type |

## Tests

- `transcript-view-antigravity.spec.ts`: the fixture, folded whole; prompt detection; each row
  kind; argument decoding; stamp stripping only at the top; the unknown-row cases.
- `transcript-view-read.spec.ts`: antigravity moves to "none when nothing is written"; a planted
  conversation is read through the key fallback; the default-store-list test now swaps muse's probe,
  muse being the only store left; the antigravity process-gone test is dropped (the muse one
  covers the same path).
- The fixture keeps `created_at`, the calls' `args`, and the outputs' stamp lines, with output
  bodies blanked and paths rewritten.
