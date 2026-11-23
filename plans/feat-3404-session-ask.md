# feat: send to a session you started, and wait for its reply (#3404)

The groundwork of #3403: an agent that started another session can type into it and read what it
answered, whichever agent either side is (claude → codex, codex → claude, …). The review loop the
umbrella describes is built on top of this later; nothing here runs a loop.

## Three changes

1. **`spawnBackgroundChat` advertises `agent`.** The route already accepts it
   (`background-chat.ts`); the MCP schema never said so, so no model used it. The `hidden`
   description, which claimed the flag is ignored, is corrected — it does work. MulmoClaude's tool
   has no `agent` (it has one agent), so this is a deliberate divergence, said so in the comment.
   The route records the caller (the broker's `SESSION_HEADER`) as the new session's parent.
2. **`sendToSession { session, message }`** pastes the message into a session the CALLER started
   and presses Enter, through the existing sender (`server/session/session-input.ts`). It refuses
   while a question dialog is open, the same `blocked` check the board's reply box uses, and the
   text rules are the reply box's (`readReplyRequest`).
3. **`waitForSessionReply { session, waitSeconds? }`** polls that session's last completed turn
   until its prompt is the text we sent (`answersOurSend`, the rule the browser's one-exchange and
   round table use) and returns the reply. If none arrives within the wait it answers "still
   working" and the caller asks again.

## Decisions

- **Only sessions you started.** An agent holding these tools must not be able to type into the
  other cells the user has open. Parentage is recorded at spawn, keyed by the caller's session id.
  That id is the broker's header — an assertion, not a credential — so this limits the tools, not
  local processes: `POST /api/terminal/:id/reply` already lets any local process type into any
  session, with no header at all.
- **Each message carries a short tag** (`[sendToSession <id>]`). The wait recognises the reply by
  the end of the prompt it answers, so a message sent twice would otherwise match the earlier turn.
- **Send and wait are two tools.** A tool call has a ceiling the server does not control: codex
  gives up on an MCP call after its tool timeout, and the broker's own `fetch` stops waiting for
  response headers after undici's default. So the wait is bounded per call (a default under codex's
  timeout, a maximum under undici's) and the caller loops.
- **Ungrouped**, like `spawnBackgroundChat`: offered only on the all-tools URL (the workspace).
  A tool that drives another session has no business in a project cell's groups.
- **In memory.** Parentage and the last sent text live for the server process. After a restart,
  a session started before it can no longer be sent to; the refusal says so.

## Out of scope

- Choosing a worktree or directory for the spawned session (how it meets "one worktree, one agent"
  is its own decision).
- A loop run by the server (#3403 decision 1) — the next children build it on these tools.
- muse replies (#3375): its log is not parsed, so the wait refuses rather than waiting forever.
