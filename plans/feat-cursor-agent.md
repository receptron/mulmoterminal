# Cursor CLI as the seventh hosted agent

Issue: [#2064](https://github.com/receptron/mulmoterminal/issues/2064) — implementing
[#2055](https://github.com/receptron/mulmoterminal/issues/2055).
Measured against **cursor-agent 2026.09.10-fd3934a** on macOS. Nothing here is read off a vendor
page; where a vendor claim and a measurement disagree, the measurement is recorded and the claim is
named as wrong.

## What the probe established

`docs/agent-capability-matrix.md` listed Cursor as documentation-only and named the deciding probe:
*"put a `stop` hook in `~/.cursor/hooks.json`, run one turn, and see whether it fires."* Run, with
three results that each change the design.

### 1. The hook config is strict, and one bad name voids the whole file, silently

A first probe armed sixteen event names and **nothing fired at all** — not one event, on a turn
that edited a file and completed. One of the sixteen (`notification`) is not a real event name.
That single entry discarded the other fifteen. There is no error, no warning, and nothing on
screen distinguishes "hooks are off" from "your config was rejected".

This is why `CURSOR_HOOK_EVENTS` is **derived from the translation map** rather than written out,
and why a spec pins every registered name against the CLI-supported set. A typo here does not
degrade the feature; it removes it, quietly.

### 2. The interactive TUI and print mode do not fire the same events

| event | `-p` (print) | interactive TUI |
|---|---|---|
| `beforeSubmitPrompt` | no | **yes** |
| `afterAgentResponse` | no | **yes** |
| `stop` | no | **yes** |
| `preToolUse` / `postToolUse` / `postToolUseFailure` | yes | yes |
| `beforeShellExecution` / `afterShellExecution` | yes | yes |
| `beforeReadFile` / `afterFileEdit` / `afterAgentThought` | yes | yes |

Both columns were reproduced here. The community bug report the matrix recorded as the whole risk
([forum #169059](https://forum.cursor.com/t/cursor-cli-omits-beforesubmitprompt-afteragentresponse-and-stop-hooks-loses-token-usage-and-emits-inconsistent-generation-id-values/169059))
describes the **print-mode** column and does not separate the two modes. A grid cell runs the TUI,
so the three events that report calls missing are exactly the three this feature needs, and they
are present.

### 3. Where a hook file may live — and the per-spawn option does not work

| location | TUI |
|---|---|
| `~/.cursor/hooks.json` (user) | fires |
| `<workspace>/.cursor/hooks.json` (project) | fires |
| `--plugin-dir <dir>` (per-spawn) | **does not fire** — print mode only |

`--plugin-dir` would have been the clean answer: per-spawn, like claude's `--settings`, needing no
ownership machinery at all. It does not work for the TUI. The CLI's submit path consults only the
user and project configs, which is visible in the shipped bundle and was then confirmed by running
a turn under each.

**One measurement had to be taken twice.** The first project-level and `--plugin-dir` runs both
reported "no `stop`", and both were wrong: the wait loop keyed on `Add a follow-up`, which stays on
screen after the first turn, so every later turn was read before it finished. Re-measured by
polling the hook log instead. The recorded result is the second one.

## Decisions

**D1. The hook file is `~/.cursor/hooks.json`, machine-global, with copilot's ownership machinery.**
The project alternative works but writes into the user's own repository, where it lands in
`git status` and can be committed by accident; a status feature must not edit a tracked tree.

**D2. A file we did not write is refused, not merged.** Cursor's path is a FIXED name — unlike
copilot, where we choose `hooks/mulmoterminal.json` inside a scanned directory — so a user who
already keeps hooks there (GitButler writes one) collides with us by construction. Merging our
entries into their arrays and un-merging on exit re-introduces exactly the tear that
`copilot-hooks-file.ts` was rewritten to remove: a crash between the two writes leaves their file
carrying our commands, pointed at a dead port. Refuse and warn; the cost is status for that user,
and it is visible in the log rather than silent.

**D3. Identity is minted before the spawn — and `create-chat` is NOT needed to do it.** This was
written before the last measurement and the measurement changed it: a uuid this server invented,
never passed through `create-chat`, is accepted by `--resume`, starts a new chat under that id, and
comes back as the `conversation_id` on every hook of the session. So the id is ours with no
subprocess at all, which is exactly copilot's `--session-id` shape — no watcher, no attribution
guess, no conversation map. `cursor-agent create-chat` exists and prints an id; reaching for it
would add a process spawn to every cell to learn something we had already decided.

**D4. The seed is a positional argument.** `cursor-agent --resume <id> '<prompt>'` starts the TUI
and runs the prompt inside it, and the TUI survives the turn (measured). `-p` is the run-and-exit
mode and must not be used — the same trap copilot's `-p` set, reached from the other side.

**D5. Blocked-on-input is NOT wired, and `beforeShellExecution` must not be mapped to
`Notification`.** While the agent sits on `Waiting for approval...`, the events already fired are
`beforeSubmitPrompt`, `preToolUse`, `beforeShellExecution` and `afterAgentThought` — every one of
which fires on every tool call whether or not anyone is asked. That is copilot's `permissionRequest`
shape, and mapping any of them to `Notification` would flag every tool call as needing the user.

**D6. Cursor is OUT of `FULL_GUI_MCP_AGENTS`.** MCP is file-based only (`~/.cursor/mcp.json` or
`.cursor/mcp.json`); there is no per-spawn flag to hand one session a scoped URL. That puts cursor
with agy/grok/muse: the per-group toggles its directory registered, which is the truthful answer.

**D7. `--trust` is passed.** A directory Cursor has not seen shows a blocking Workspace Trust gate,
which in a grid cell is a prompt nobody is watching. `--force` covers tool approval the same way
copilot's `--allow-all-tools` does.

## Files

Mirroring the copilot addition (#2063):

- `server/agents/cursor.ts` — adapter, `CURSOR_BIN`
- `server/agents/cursor-args.ts` — `--resume <id>`, `--force`, `--trust`, `--model`, positional seed
- `server/agents/cursor-hook.ts` — payload translation, `CURSOR_HOOK_EVENTS` derived from the map
- `server/agents/cursor-hooks-file.ts` — the machine-global file, ownership as in copilot's
- `server/agents/cursor-sessions.ts` — the chat store: the cwd-bound resume probe and the listing
- `server/session/spawn-cursor.ts` — the spawner
- the typed lists: `common/sessionAgent.ts`, `common/guiMcpAgents.ts` (out), badges
- routes: `ws-routes.ts`, `hook-routes.ts`, `session-routes.ts`, `plugin-routes.ts`, `terminal-ws-path.ts`
- UI: `agentPicker.ts`, `AgentMark.vue`, `modelBadge.ts`, `wsUrl.ts`, `launchCell.ts`
- `docs/agent-capability-matrix.md` — cursor becomes a column; Open candidates loses its last row

## What this does not do

Row 3a (blocked on input) and row 15 (accounting) are out of scope for this change. The token counts
`stop` carries (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) are
recorded in the matrix as available and left unread, as copilot's `assistant_usage_events` are.
