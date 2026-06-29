# refactor: centralize GUI stores under ~/.mulmoterminal (#41)

Prerequisite for the "open any directory" feature.

## Change

- `createSessionStore` now roots at `~/.mulmoterminal/<name>` (new `MULMOTERMINAL_HOME`)
  instead of `<CLAUDE_CWD>/<name>`.
- `.toolresults`/`.toolcalls` → `~/.mulmoterminal/toolresults` / `~/.mulmoterminal/toolcalls`
  (sessionId-keyed; sessionIds are global UUIDs, so no per-dir namespacing is needed).
- `artifacts/` (markdown/charts generated content) intentionally stays under the
  workspace dir — claude references it relative to its cwd; it follows the active
  directory and is handled in the dir-switch step.
- claude's own session transcripts (`~/.claude/projects/...`) are unchanged.

## Why

The stores were pinned to the startup `CLAUDE_CWD`, blocking runtime directory
switching. Keyed by sessionId, they don't need to be per-dir.

## Notes

- No migration of existing `<CLAUDE_CWD>/.toolresults|.toolcalls` (old sessions lose
  GUI-replay / tool-pane history; terminal + claude .jsonl unaffected). 0.1.x.
- Behavior otherwise unchanged. No version bump — bundled with the dir-switch feature.

## Verified

- `lint` / `typecheck:server` / `test` (29) / `build` green.
- Posting a PreToolUse hook + a toolResult writes to `~/.mulmoterminal/{toolcalls,toolresults}/<id>.json`, not under `CLAUDE_CWD`.
