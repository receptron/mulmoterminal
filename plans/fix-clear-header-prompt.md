# Fix — clear the cell header prompt on `/clear`

## Problem

The grid cell header (`TerminalCell.vue` `.cell-prompt`) shows the session's last user prompt. It comes
from the server's `lastPrompts` map (set by the `UserPromptSubmit` hook) with the transcript as a
fallback (`/api/session/:id` → `lastPrompts.get(id) ?? transcriptPrompt`).

When the user runs Claude's **`/clear`**, the conversation restarts but the header keeps showing the
**pre-clear prompt** — nothing tells the server the conversation was cleared. It only updates once the
next `UserPromptSubmit` fires.

## Scope (user decision)

Reset **only the header prompt/summary** on `/clear`. Do NOT touch the tool-call history (ToolsPane) or
anything else. `/compact` is left alone (it keeps the conversation, so the prompt stays relevant).

## Fix

Claude Code fires a `SessionStart` hook with `source: "clear"` on `/clear` (confirmed via docs). The tool
doesn't register `SessionStart` today.

- **`hookSettingsJson`**: register `SessionStart` (alongside UserPromptSubmit/Stop/…).
- **`/api/hook`**: when `hook_event_name === "SessionStart"` and `source === "clear"`, blank the header
  prompt for that `session_id` and publish so the header updates live:
  - `clearHeaderPrompt(id)` → `lastPrompts.set(id, "")` (empty beats the `?? transcriptPrompt` fallback, so
    a stale transcript prompt can't resurface) → `publishActivity(id)`.
- The next `UserPromptSubmit` sets the new query as usual (`preferredHeaderPrompt("", incoming)` returns a
  meaningful `incoming`), so the header shows the next query. Client shows its neutral fallback (short
  session id) in between — the same state as a brand-new session.

No client change: `applyActivity` already applies `lastPrompt` (including empty), and `.cell-prompt`
renders the fallback when it's empty.

## Caveat to verify live

If Claude Code issues a **new `session_id`** on `/clear` (docs report a new `transcript_path` but don't
confirm whether the id changes when launched with `--session-id`), the hook would fire for the new id and
the client (keyed by the original id) wouldn't update. mulmoterminal launches with `--session-id`, so the
id is expected to be stable — but this needs a live `/clear` test. If the id changes, add a remap step.

## Tests

- Unit-test the hook handler path: a `SessionStart`/`source:"clear"` POST blanks `lastPrompts[id]`;
  `source:"resume"`/`"compact"` and other events don't.
- `hookSettingsJson` includes `SessionStart`.
