# feat: wire the GUI MCP to Cursor CLI

Issue: [#2066](https://github.com/receptron/mulmoterminal/issues/2066) — follows #2064 / #2065.

## What the issue expected, and what measuring changed

#2065 hosted cursor with status, resume and tool history and left the GUI MCP out, because writing
`.cursor/mcp.json` puts a file in the user's own repository — its own decision with its own
invariants. The issue predicted an agy-shaped writer plus `--approve-mcps`. Two of the three guesses
did not survive contact with `cursor-agent 2026.09.10-fd3934a`.

**What was measured, in this order:**

1. **The project file DOES load in the interactive TUI.** The hook loader in this same CLI does not
   (`--plugin-dir` delivers hooks in `-p` print mode only, which is why the hooks file is registered
   machine-globally), so this had to be run rather than assumed. A probe MCP server in
   `.cursor/mcp.json` was listed and called from a tmux TUI session.
2. **An unapproved server is SILENTLY ABSENT.** Not a prompt, not an error: the agent reports
   `namespace "x" not found. Available namespaces: cursor` / "No MCP servers available". Writing the
   file is half the work and the other half fails invisibly.
3. **Approval is per project**, in `~/.cursor/projects/<slug>/mcp-approvals.json`, as
   `<id>-<hash of the entry>`. The hash is why approval runs on every spawn: change the bridge argv
   and the recorded approval stops matching, with no error anywhere.
4. **Cursor starts an MCP server on a CURATED environment.** Found only by running the whole thing
   end to end — the file was written, the approval recorded, and the cell still saw no server. Which
   half arrived is the proof: that first attempt wrote agy's entry shape — the group in the entry's
   own `env` block, the port left to inheritance — and the group reached the bridge while the port did
   not, so the bridge refused with *"the mulmoterminal port is not set"*. Both are argv now.

So cursor is **agy-shaped for the FILE and muse-shaped for the SESSION**: the group and the port are
argv, and the session is resolved through `/api/mcp-resolve` by walking the process tree.

`--approve-mcps` is deliberately NOT used: it approves — and persists — every server in the user's
file, including ones they left unapproved. `cursor-agent mcp enable <id>` approves exactly the ids we
wrote; measured at ~0.4s, idempotent, and skipped entirely when the directory registered nothing.

## Shape

- `server/agents/cursor-mcp.ts` — the writer, the approver, and `syncCursorDirectoryMcp` which is
  both. Merge is pure; the user's own entries are never touched.
- `.git/info/exclude` only when WE created the file — grok's rule, not agy's, for grok's reason: a
  project config a team committed on purpose must not be hidden from them.
- `server/session/spawn-directory-mcp.ts` — `syncDirectoryMcpForSpawnAsync`, the same
  "not on a reattach" guard for a sync that has to be awaited.
- `server/session/spawn-cursor.ts` — `guiMcpEnv` on the spawn (for the tmux pane's own environment)
  and `rememberEntitledToolGroups`, which is what the resolve route answers the bridge with.
- `server/session/bridge-session.ts` — the resolvable-agent list is no longer muse-only. It stays a
  CLOSED list: an agent joins it only once measured to inherit nothing.
- `common/guiMcpAgents.ts` — `DIRECTORY_MCP_BLIND_AGENTS` deleted, as its own comment instructed
  ("Delete this the day #2066 lands"), with the launcher branch and its spec.

## Verified by running it

A real server on a spare port, `render` registered for a scratch project, a cursor cell opened over
`/ws/cursor`, and a turn driven in the pane:

- the cell lists `presentDocument / presentForm / presentChart / presentHtml / presentShapeScript /
  renderShapeScript / exportShapeScriptUsdz`
- calling `presentDocument` produced `[gui] toolResult presentDocument for <that session id>` in the
  server log — so the bridge resolved to the RIGHT session, which is the half a tools/list does not
  prove
- the same run BEFORE the argv fix reported no MCP server at all, which is what sent the design back
