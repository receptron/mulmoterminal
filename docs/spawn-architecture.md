# How a `claude` session is spawned

Every MulmoTerminal session is a **real, interactive `claude` running in a PTY**
(`node-pty`), streamed to the browser over a WebSocket. It is **not** a headless
agent — it's the normal Claude Code TUI. MulmoTerminal only injects a few flags to
wire the session into the sidebar, the GUI panel, and permission handling.

This document lists every spawn setting, what it's for, and the risk of changing
it — and the open decision around MCP scoping.

## The spawn call

`server/index.ts` → `spawnClaudePty()`:

```ts
pty.spawn(CLAUDE_BIN, [
  // session identity (one of):
  "--session-id", "<uuid>",        // new session (server-chosen id)
  "--resume",     "<uuid>",        // resume an existing session
  // wiring:
  "--settings",        "<hooks json>",
  "--permission-mode", CLAUDE_PERMISSION_MODE,
  "--mcp-config",      "<gui mcp json>",
  "--strict-mcp-config",
  "--allowedTools",    "<gui tool names>",
  // optional (spawnBackgroundChat only):
  "--", "<initial prompt>",
], {
  name: "xterm-256color",
  cols: 120, rows: 30,             // initial size; client resizes on connect
  cwd: CLAUDE_CWD,                 // the workspace
  env: process.env,               // full env passthrough
});
```

## Current settings

| # | Setting | Value / source | Purpose | Risk if changed / removed |
|---|---------|----------------|---------|---------------------------|
| 1 | program | `CLAUDE_BIN` (env, default `claude`) | The binary run in the PTY | Wrong/missing → spawn fails (now caught: the connection closes with an error instead of crashing the server) |
| 2 | `cwd` | `CLAUDE_CWD` (launcher `--cwd` / env, default `~/mulmoclaude`) | Directory claude runs in. **Also scopes** which `.claude/skills` and (if enabled) `.mcp.json` are picked up, and which `~/.claude/projects/<encoded cwd>` session list the sidebar shows | Change → a different project + session list; missing dir is `mkdir -p`'d |
| 3 | `env` | `process.env` (full passthrough) | claude finds the CLI + tools via `PATH`, and sees `CLAUDE_CWD` / any API keys present | Narrowing risks breaking `PATH` / auth; full passthrough also exposes all server env to the child |
| 4 | `--session-id <uuid>` | new sessions | Server picks the id up front, so it knows the session before claude writes any file | Must be a fresh UUID; reuse collides with an existing session |
| 5 | `--resume <uuid>` | existing sessions | Continue a prior conversation | The session must exist **in this cwd's project**; resuming under the wrong cwd → "not found" |
| 6 | `--settings <hooks json>` | `hookSettingsJson()` | Injects hooks that `curl POST /api/hook` on `UserPromptSubmit` / `Stop` / `Notification` / `Pre`/`Post`ToolUse(`Failure`) → drives the sidebar **working / needs-attention** dots and the **Tools-pane history** | Remove → sidebar goes static, no tool-call history. The hook URL (`localhost:PORT`) must be reachable **from wherever claude runs** (today: same host) |
| 7 | `--permission-mode <mode>` | `CLAUDE_PERMISSION_MODE` (env, default `auto`) | How claude handles tool approval | `auto`/`bypassPermissions` = hands-off; tightening makes it prompt more (in the terminal) |
| 8 | `--mcp-config <gui mcp json>` | `mcpConfigJson()` → `{ type: "http", url: /mcp/<sessionId> }` | Registers the **GUI MCP** server that backs the panel plugins (`presentDocument`, `presentForm`, `generateImage`, …) | Remove → the GUI panel plugins stop working |
| 9 | `--strict-mcp-config` | always | **Load ONLY** the MCP from `--mcp-config`; ignore the user's (`~/.claude.json`) and the project's (`.mcp.json`) MCP servers | Keeps the session minimal/predictable, **but disables all of the user's & workspace MCP servers** (see the decision below) |
| 10 | `--allowedTools <gui tool names>` | `allowedToolNames()` | Auto-allow the GUI MCP tools so they don't trip a permission prompt | Remove → each GUI tool call prompts for approval |
| 11 | `-- <initial prompt>` | `spawnBackgroundChat` only | First message for a headless-spawned session. `--` ends option parsing so a prompt starting with `-` can't be read as a flag | — |
| 12 | `cols` / `rows` | `120` / `30` | Initial PTY size; the client sends a `resize` on connect | Cosmetic initial value only |
| 13 | `name` | `xterm-256color` | `TERM` type for the PTY | Standard; rarely changed |

## How skills & MCP get scoped (the `cwd` story)

Both are resolved by claude **relative to its `cwd`**, which is the key to
per-workspace behaviour:

- **Skills** — claude loads `.claude/skills` (project, relative to `cwd`) **plus**
  `~/.claude/skills` (user). Because we spawn with `cwd = the workspace`, a
  workspace's skills are active **only for that workspace's sessions** — no
  cross-project mixing. This is automatic, and the directory-switch feature
  preserves it (each session keeps its own `cwd`).
- **MCP** — claude would normally also load user MCP (`~/.claude.json`) and
  project MCP (`.mcp.json`, relative to `cwd`). **But `--strict-mcp-config`
  disables all of that** — today **only the GUI MCP runs**. So "workspace-assuming
  MCP servers" don't run at all right now.

## Where the GUI tools (presentDocument, …) actually come from

They are **not in any `mcp.json` file** — they are code, served in-process. The
pipeline:

1. **`plugins/plugins.json`** lists the plugin packages (npm dependencies):
   | Package | Tool it provides |
   |---|---|
   | `@mulmoclaude/markdown-plugin` | `presentDocument` |
   | `@mulmoclaude/form-plugin` | `presentForm` |
   | `@mulmochat-plugin/generate-image` | `generateImage` |
   | `@mulmoclaude/chart-plugin` | `presentChart` |
   | `@mulmoclaude/x-plugin` (`servers`) | X/Twitter integration |
2. **`server/plugins-registry.ts`** loads those, then appends **host-provided**
   tools from `HOST_TOOL_DEFINITIONS` (`server/host-tools.ts`) — currently
   `spawnBackgroundChat`.
3. **`server/index.ts`** serves them as a **single MCP server named
   `mulmoterminal-gui`**, in-process over Streamable HTTP at `POST /mcp/<sessionId>`
   (built by `buildGuiMcpServer()`).
4. Each spawned claude is pointed at it via `--mcp-config`:
   ```json
   { "mcpServers": { "mulmoterminal-gui": { "type": "http", "url": "http://127.0.0.1:<PORT>/mcp/<sessionId>" } } }
   ```

So claude sees them as `mcp__mulmoterminal-gui__presentDocument`, etc. The live
list is `GET /api/tools` → currently: **presentDocument, presentForm,
generateImage, presentChart, spawnBackgroundChat**.

## What MCP is — and isn't — loaded today

| Source | Path | Read by | Loaded in MulmoTerminal now? |
|---|---|---|---|
| **GUI MCP** (`mulmoterminal-gui`) | in-process, `/mcp/<sessionId>` (from `plugins/plugins.json`) | injected via `--mcp-config` | ✅ **yes — the only MCP** |
| Claude Code **user** MCP | `~/.claude.json` | Claude Code | ❌ no — `--strict-mcp-config` ignores it |
| Claude Code **project** MCP | `<cwd>/.mcp.json` (e.g. `~/mulmoclaude/.mcp.json`) | Claude Code | ❌ no — `--strict-mcp-config` ignores it |
| **MulmoClaude** MCP | `~/mulmoclaude/config/mcp.json` | **MulmoClaude's server only** | ❌ no — see below |

### Is `~/mulmoclaude/config/mcp.json` ignored? → Yes, completely.

Three independent reasons, any one of which is enough:

1. **It's MulmoClaude's file, not a Claude Code / MulmoTerminal file.** MulmoClaude's
   server reads `config/mcp.json` and feeds it to claude. MulmoTerminal has **no
   code that reads it** (confirmed: nothing in `server/` references `mcp.json` /
   `config/mcp.json`).
2. **Claude Code wouldn't auto-load `config/mcp.json` anyway.** Its project MCP file
   is `<cwd>/.mcp.json` (i.e. `~/mulmoclaude/.mcp.json`) — not `config/mcp.json`.
3. **`--strict-mcp-config`** makes claude load *only* the `--mcp-config` server (the
   GUI MCP), ignoring even the standard `~/.claude.json` / `<cwd>/.mcp.json`.

→ Your `config/mcp.json` servers run under **MulmoClaude**, not MulmoTerminal. To
use them in MulmoTerminal you would (a) **drop `--strict-mcp-config`** *and*
(b) put them where Claude Code looks (`~/.claude.json` user scope, or
`<cwd>/.mcp.json` project scope) — or have MulmoTerminal explicitly read & merge
that file. This is exactly the trade-off in the next section.

## Decision: MCP scoping

| | A. Keep `--strict-mcp-config` (current) | B. Drop `--strict-mcp-config` (like mulmoclaude) |
|---|---|---|
| MCP loaded | GUI MCP only | GUI MCP **+** user (`~/.claude.json`) **+** project (`.mcp.json`), all `cwd`-scoped |
| Workspace MCP | ❌ not available | ✅ works, naturally **per-workspace** (same isolation as skills) |
| Predictability | ✅ minimal, fixed surface | ⚠️ depends on each project's `.mcp.json` |
| Trust prompts | none | project `.mcp.json` triggers a "trust this server?" prompt (handled in the interactive terminal) |
| GUI MCP coexistence | n/a | must verify GUI + user/project MCP coexist (mulmoclaude confirmed on recent CLI) |
| Resources | one MCP (HTTP, in-process) | + one process per project MCP server, per session |
| Permission interaction | simple | verify behaviour with `--permission-mode auto`/`bypass` |

**Recommendation:** for the "open any directory" direction, **B** is the
consistent choice — a workspace then means *its skills **and** its MCP*. Before
committing, **spike B** locally to confirm GUI + project MCP coexistence, the
trust-prompt flow, and the interaction with `--permission-mode`.

## Interaction with the directory-switch feature

- A new session inherits the **active workspace's `cwd`** → its skills (and, under
  B, its MCP). A **resumed** session keeps its **original `cwd`**. So switching
  workspaces never mixes skills/MCP across projects.
- GUI stores (`.toolresults` / `.toolcalls`) were centralized to
  `~/.mulmoterminal/` (#42), so they're directory-independent. `artifacts/`
  (generated docs/charts) intentionally stays under the workspace `cwd` because
  claude references it relative to its `cwd`.

## Note for "run claude elsewhere" (e.g. Docker)

Settings #6 (hook URL) and #8 (MCP URL) are `localhost`/`127.0.0.1` — they assume
claude runs on the **same host** as the server. If claude is ever run in a
container, those must point at the host (e.g. `host.docker.internal`), and `cwd` /
auth (`~/.claude`) must be mounted. (See the abandoned PR #30 for prior art.)
