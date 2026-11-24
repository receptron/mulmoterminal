# fix #3464: a server-started codex keeps its sandbox grants across a cold resume

## Problem

A codex the server starts (an implementer from `startIssueSession`, a reviewer from `requestReview`)
is handed three grants at spawn: network access (#3452), the worktree's git metadata as writable
roots (#3455), and `approval_policy="never"` (#3461). A tmux reattach keeps the running process and
with it the grants. A cold resume does not: `startCodexEntry` in `server/routes/ws-routes.ts` calls
`spawnCodexPty` with only `mcpGroups`, so the resumed codex has no network, cannot commit, and
stops on approval prompts again.

## Fix

Record the grants per session id when a spawn is handed them, and read them back on every later
spawn of that id — the shape the GUI group restriction (#3033) and the permission mode (#3334)
already take.

- `server/session/spawn/agents/codex-grant-log.ts` — pure: the record, its line, and parsing a line
  back (anything malformed is dropped; a dropped line means no grant, which is the narrow side).
- `server/session/spawn/agents/codex-session-grants.ts` — the map, its append log
  `~/.mulmoterminal/codex-session-grants.jsonl`, hydration, and `codexSessionGrants(id, asked)`.
- `spawnCodexPty` asks it, and the codex WS handler awaits its hydration before resolving, so a
  reconnect that arrives during startup does not resume without the grants.

## Decisions

- Only a spawn that is handed a grant records one. A codex cell the user opens has none, as before.
- A resume under the rollout id (opening a conversation from the list) does NOT inherit, unlike the
  GUI restriction: that is a cell the user opened, and a widening should not travel to it. The GUI
  restriction inherits because it narrows.
- The writable roots are kept as recorded rather than recomputed: they are what the session was
  granted, and a resume is the same session in the same worktree.
- A record is never dropped, like the other per-session logs: a closed implementer reopened by its
  session id comes back with what it was started with.
