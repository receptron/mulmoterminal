# GUI Chat Protocol Spike (mulmoterminal)

A throwaway spike inside **mulmoterminal** to learn what it takes to support
MulmoClaude's **GUI chat protocol** (`presentMarkdown`, `presentForm`, …) on top
of the **interactive PTY** architecture. The lessons feed the larger MulmoClaude
migration — see [Background](#background).

> Status: planned. Fill in the **Findings** sections as each phase lands.

---

## Background

MulmoClaude today drives Claude Code in **headless `claude -p` (stream-json)**
mode and parses the stream into events that render the chat *and* the GUI. We
are moving it to the **mulmoterminal mechanism**: spawn the **interactive
`claude` CLI in a PTY**, relay it to an xterm terminal, and **eliminate every
`claude -p` invocation** (the north star).

The one thing that approach has never proven is whether the **GUI chat
protocol** survives the move. In MulmoClaude the GUI is driven by **MCP tools**
that push a structured `data` payload server-side — which is *transport-
agnostic* and should work identically under an interactive PTY. This spike
validates that end-to-end in the smallest possible codebase before we touch
MulmoClaude.

### The seam under test

```
 interactive claude (PTY)
        │  calls MCP tool  presentMarkdown({ markdown })
        ▼
 stdio MCP server  ──HTTP POST /api/gui {sessionId,type,data}──►  mulmoterminal server
        ▲                                                              │ publish on "gui"
        │  (Phase II: blocks for the answer)                           ▼
        └────────────── answer ◄── /api/gui/answer ◄──────  GUI panel (Vue, right side)
                                                            renders data; submits input
```

- **Terminal (left panel):** the raw interactive CLI, unchanged.
- **GUI (right panel):** renders from the tool's `data` field.
- **`data` channel:** MCP tool → `/api/gui` → existing socket.io pub/sub → panel.
  (Mirrors MulmoClaude's "MCP server posts a toolResult to an internal route".)

---

## Phase I — `presentMarkdown` (one-way)

**Goal:** prove the full **MCP tool → `data` → GUI panel** pipe with the
simplest possible plugin. `presentMarkdown` is one-directional (LLM emits
markdown, panel renders it), so it isolates the data pipe with no round-trip.

### Steps

1. **MCP server** — a small stdio server (`server/mcp/present-markdown.js`)
   exposing one tool `presentMarkdown({ markdown })`. On call, it `POST`s
   `{ sessionId, type: "presentMarkdown", data: { markdown } }` to
   `http://localhost:<PORT>/api/gui`, then returns a short ack string to claude.
   - `sessionId` + `PORT` reach the MCP process via **env** (set when we build
     its mcp-config), mirroring MulmoClaude's `MULMOCLAUDE_CHAT_SESSION_ID`.
2. **Spawn wiring** — when spawning `claude`, also pass `--mcp-config <file>`
   (alongside the existing `--settings` hooks) and add the tool to
   `--allowedTools` so it auto-runs (sidesteps the permission prompt, which is a
   separate probe — see [Deferred](#deferred-probes)).
3. **Server endpoint** — `POST /api/gui` in `server/index.js`: validate the
   frame, store the latest payload(s) **keyed by `sessionId`** (in-memory for
   the spike), and `pubsub.publish("gui", { sessionId, type, data })`.
4. **History fetch** — `GET /api/gui/:sessionId` returns the stored payloads so
   the panel can **replay** when the user selects a session.
5. **GUI panel** — `src/components/GuiPanel.vue`: subscribe to the `gui` channel
   (filter by the active session id), render markdown (add `marked` +
   sanitization). On session change, load history via `GET /api/gui/:sessionId`.
6. **Layout** — `App.vue` becomes `Sidebar | [ Terminal | GuiPanel ]` (the
   unified two-panel view in miniature).

### Acceptance

- Tell claude "use presentMarkdown to show me a table of …"; the **terminal**
  shows the tool call and the **right panel** renders the markdown.
- Switching sessions in the sidebar replays the correct session's GUI.

### Findings (after Phase I)

Status: **implemented and smoke-tested** end-to-end (MCP stdio handshake → tool
call → `/api/gui` → in-memory store → history replay). Driving it from a real
interactive `claude` is the remaining manual check.

- **How `--mcp-config` is wired into the interactive spawn:** the interactive
  `claude` accepts `--mcp-config <configs...>` as **JSON strings** (not only file
  paths), so `server/index.js` builds the config inline per session
  (`mcpConfigJson(sessionId)`) and appends `--mcp-config <json>
  --strict-mcp-config --allowedTools mcp__mulmoterminal-gui__presentMarkdown` to
  the existing `--settings`/`--session-id`/`--resume` args. No temp file to
  manage. `--strict-mcp-config` keeps the user's own MCP servers out of the
  spike; `--allowedTools` auto-runs the tool (no permission prompt — the
  permission flow stays a deferred probe).
- **How `sessionId` propagates to the MCP process:** via the MCP server's `env`
  block in the config (`MULMOTERMINAL_SESSION_ID`, `MULMOTERMINAL_PORT`). This
  is necessary because every PTY shares the server's single `process.env`, so
  per-session values can't ride on the parent env — they must be baked into the
  per-spawn config. Mirrors MulmoClaude's `MULMOCLAUDE_CHAT_SESSION_ID`.
- **Shape of the `data` channel that maps cleanly onto MulmoClaude:** the MCP
  tool `POST`s `{ sessionId, type, data }` to `/api/gui`; the server stores it
  keyed by `sessionId` and `pubsub.publish("gui", { sessionId, type, data })`.
  The panel filters the `gui` channel by the foreground `sessionId` and replays
  history from `GET /api/gui/:sessionId`. `type` is the discriminator
  (`presentMarkdown` now; `presentForm` next) and `data` is the opaque
  tool-specific payload — exactly MulmoClaude's "MCP server posts a toolResult
  to an internal route" pattern, transport-agnostic over the PTY.
- **Surprises / blockers:** none blocking. Notes: used the official
  `@modelcontextprotocol/sdk` (+ `zod`) for a correct stdio handshake rather
  than hand-rolling JSON-RPC; the MCP server runs under the **same node binary**
  (`process.execPath`) as the server. Markdown is rendered with `marked` and
  **sanitized with DOMPurify** before `v-html` (the one XSS-sensitive seam).
  GUI history is in-memory and intentionally **not** dropped on PTY reap, so a
  closed/background session still replays its panel when reselected.

---

## Phase II — `presentForm` (round-trip)

**Goal:** prove **GUI input flows back into the agent**. `presentForm` is the
hard case: the tool call must **block** until the user submits, then **return
the answer to claude** so the conversation continues.

### Key challenge

The MCP server runs as a **subprocess of `claude`**, so its tool handler must
await the user's answer that arrives via the browser → mulmoterminal server.
Plan: the handler `POST`s the form to the server and **long-polls** (or holds
the request open) on a `requestId`; the panel renders the form; on submit the
browser `POST`s the answer to `/api/gui/answer` with that `requestId`; the
server resolves the held request; the handler returns the answer to claude.

### Steps (refine with Phase I learnings)

1. Add `presentForm({ schema })` to the MCP server; generate a `requestId`.
2. Server: register a pending request; publish the form on `gui`; hold a
   response until `/api/gui/answer` arrives (or times out).
3. Panel: render a form from `schema`; on submit `POST` the answer.
4. Handler returns the answer to claude; verify the session continues using it.

### Acceptance

- claude calls `presentForm`; the panel renders a form; the user submits; the
  answer reaches claude and the turn continues with it.

### Findings (fill in after Phase II)

- How the blocking round-trip is implemented and how robust it is:
- Timeout / abandoned-form behavior:
- What this implies for MulmoClaude's `presentForm` / `handlePermission`:

---

## Deferred probes

- **Permission flow (`--permission-prompt-tool`).** `presentMarkdown` is
  auto-allowed, so it won't exercise permissions. A follow-on probe: add a tool
  that triggers an "ask" and observe whether interactive mode honors
  `--permission-prompt-tool` or falls back to its native in-terminal prompt.
  This is the biggest open risk for the MulmoClaude migration (the
  `AskUserQuestion → presentForm` redirect).

## Out of scope

Docker sandbox, roles, multiple plugins, durable persistence, mobile input, and
any MulmoClaude code changes. This spike is purely to **learn the seam**; the
real work lands on MulmoClaude's `staging` branch afterward.

## What this de-risks for MulmoClaude

A working Phase I + II turns MulmoClaude milestone **M3 (plugins + GUI chat
protocol)** from "invent it on the integration branch" into "port a proven
pattern" — and tells us early whether the GUI survives the interactive PTY at
all, which is the load-bearing assumption of the entire migration.
