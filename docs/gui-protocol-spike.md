# GUI Chat Protocol Spike (mulmoterminal)

A throwaway spike inside **mulmoterminal** to learn what it takes to support
MulmoClaude's **GUI chat protocol** (`presentDocument`, `presentForm`, …) on top
of the **interactive PTY** architecture. The lessons feed the larger MulmoClaude
migration — see [Background](#background).

> Status: Phase I + II **validated against a real interactive `claude`**
> (`presentDocument` one-way and `presentForm` round-trip both work). Permissions
> are **decided, not probed** — terminal-native (see
> [Decision](#decision-permissions-are-terminal-native)).
>
> **Phase III** then upgraded the spike from its stripped-down protocol to the
> **full GUI chat protocol** — config-driven plugins, the toolResult model, and a
> GUI→LLM feedback path that **types into the PTY** (no blocking long-poll). This
> is now the high-fidelity base MulmoClaude ports from. See
> [Phase III](#phase-iii--full-gui-chat-protocol).

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
        │  calls MCP tool  presentDocument({ markdown })
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

## Phase I — `presentDocument` (one-way)

**Goal:** prove the full **MCP tool → `data` → GUI panel** pipe with the
simplest possible plugin. `presentDocument` is one-directional (LLM emits
markdown, panel renders it), so it isolates the data pipe with no round-trip.

### Steps

1. **MCP server** — a small stdio server (`server/mcp/present-markdown.js`)
   exposing one tool `presentDocument({ markdown })`. On call, it `POST`s
   `{ sessionId, type: "presentDocument", data: { markdown } }` to
   `http://localhost:<PORT>/api/gui`, then returns a short ack string to claude.
   - `sessionId` + `PORT` reach the MCP process via **env** (set when we build
     its mcp-config), mirroring MulmoClaude's `MULMOCLAUDE_CHAT_SESSION_ID`.
2. **Spawn wiring** — when spawning `claude`, also pass `--mcp-config <file>`
   (alongside the existing `--settings` hooks) and add the tool to
   `--allowedTools` so it auto-runs (sidesteps the permission prompt — permissions
   stay terminal-native, see [Decision](#decision-permissions-are-terminal-native)).
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

- Tell claude "use presentDocument to show me a table of …"; the **terminal**
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
  --strict-mcp-config --allowedTools mcp__mulmoterminal-gui__presentDocument` to
  the existing `--settings`/`--session-id`/`--resume` args. No temp file to
  manage. `--strict-mcp-config` keeps the user's own MCP servers out of the
  spike; `--allowedTools` auto-runs the tool (no permission prompt — permissions
  are terminal-native by decision, see below).
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
  (`presentDocument` now; `presentForm` next) and `data` is the opaque
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

### Findings (after Phase II)

Status: **implemented and smoke-tested** end-to-end — `presentForm` blocks the
tool call until a `POST /api/gui/answer` arrives, then returns the answer JSON to
claude; history replay shows the form as completed afterward.

- **How the blocking round-trip is implemented and how robust it is:**
  `presentForm` generates a `requestId`, `POST`s `{ requestId, schema }` to
  `/api/gui` (which registers a pending-form entry and publishes the form), then
  **long-polls** `GET /api/gui/answer/:requestId`. The server parks that response
  in the form's `waiters` set and releases it the instant the panel `POST`s
  `/api/gui/answer` — or replies `204` after a 25 s hold so the MCP process
  re-polls (an overall 10-min deadline lives in the MCP process). The 25 s
  chunked-hold avoids any single request tripping a proxy/client idle timeout,
  and `req.on("close")` drops parked responses if claude is killed mid-form. The
  whole thing rides the **same `data` channel** as Phase I — no new transport.
- **Timeout / abandoned-form behavior:** if no answer arrives within the MCP
  deadline the tool returns "the user did not submit the form (timed out)" so
  claude can recover rather than hang forever; a `404` (form gone, e.g. server
  restarted) returns "the form is no longer available." Submission is
  **idempotent** — a second `/api/gui/answer` for an already-answered form is a
  no-op, and `formAnswered` is broadcast on `gui` so any other viewer (or a
  history replay) locks the form and shows the result.
- **What this implies for MulmoClaude's `presentForm` / `handlePermission`:**
  the load-bearing assumption holds — a **blocking** GUI tool works under the
  interactive PTY with no special claude support, because the block lives
  entirely in the MCP subprocess (await an HTTP round-trip) and is invisible to
  claude, which just sees a slow tool call. `handlePermission` is the same shape
  (a blocking ask that returns allow/deny). We nonetheless chose **not** to use
  it — permissions stay terminal-native (see
  [Decision](#decision-permissions-are-terminal-native)).

---

## Phase III — full GUI chat protocol

**Goal:** Phases I + II proved the *seam* with a deliberately stripped-down,
parallel protocol (hard-coded tools, a `type` switch, a blocking `/api/gui/answer`
long-poll). Phase III makes the spike a **high-fidelity mirror of MulmoClaude's
real protocol**, so M3 is a near-copy port rather than a translation. Three shifts:

1. **Two plugins, loaded from configuration data.** The single hard-coded MCP
   server is gone. Each tool is now a self-contained **plugin package** under
   `plugins/<name>/` with a server half (`meta.js`, `definition.js`, `server.js` —
   plain JS, imported by Node) and a frontend half (`View.vue`, `index.ts` —
   imported by Vite). `plugins/plugins.json` (`{ "enabled": [...] }`) is the
   configuration data that drives loading on **both** sides: `server/plugins-registry.js`
   (server) and `src/plugins-registry.ts` (frontend, via `import.meta.glob` filtered
   by the config). Flip the list → claude is offered fewer tools and the panel
   renders fewer views, with no code change.

2. **Full toolResult model + per-plugin REST + a broker.** `server/mcp/broker.js`
   replaces `present-markdown.js`: it registers **one MCP tool per enabled plugin**
   and is a **thin HTTP bridge** — on a call it `POST`s the args to the plugin's own
   REST route (`/api/<namespace>`, mounted by the registry), gets back an envelope
   `{ data, message, instructions }`, and (only when `data` is set — *data gates
   rendering*) `POST`s a **toolResult** `{ uuid, toolName, data, jsonData, … }` to
   `POST /api/agent/toolResult`. That route stores it **keyed by session id** and
   publishes it on the per-session channel `session:<id>`. The panel renders each
   result via `getPlugin(toolName).viewComponent` — no `type` switch. This is
   MulmoClaude's exact shape (broker → REST → internal toolResult route →
   `applyToolResultToSession` → plugin view).

3. **GUI→LLM feedback types into the PTY (long-poll deleted).** The blocking
   `/api/gui/answer` round-trip is **removed entirely** (`pendingForms`, the
   `waiters` long-poll, the MCP deadline — all gone). Instead every plugin view
   receives a `sendTextMessage(text)` prop; the form view builds a markdown summary
   on submit and calls it. `App.vue` wires that to `Terminal.sendText()`, which
   writes the text into the PTY over the existing `/ws` input channel, followed by a
   **separate, delayed `\r`** (~60 ms) — a same-burst text+CR is treated as a paste
   by Claude Code's TUI and the CR becomes a newline instead of submitting. So a
   submitted form is **just the user's next turn**, exactly like MulmoClaude.
   `presentForm` therefore no longer blocks; its `instructions` tell claude to wait
   for that message.

**Persistence (what we store, and why so little).** Chat + message history already
live in the terminal and Claude's `.jsonl` (resume), so the only GUI-side store is
the **list of toolResults per session id**, replayed from
`GET /api/agent/toolResults/:id` on (re)select. A view's state change (e.g. a
submitted form's `viewState`) is persisted by re-`POST`ing the same `uuid` to
`/api/agent/toolResult`, which upserts in place (dedupe by `uuid`, mirroring
`applyToolResultToSession`) — so a revisited session shows the form as already
submitted. The store is **mirrored to disk** (one JSON file per session under
`<workspace>/.toolresults/`, via a small `createSessionStore(dirName)` helper: an
in-memory Map as the working copy, rewritten on each change and lazy-loaded on
first access) so the rendered views also survive a **server reboot**.

### Updated seam

```
 interactive claude (PTY)
   │ calls MCP tool  presentDocument / presentForm
   ▼
 broker MCP (server/mcp/broker.js)  ── one tool per enabled plugin (plugins.json)
   │ POST /api/<namespace>          ── thin HTTP bridge → plugin's REST route
   ▼
 plugin REST (plugins/<name>/server.js)  ── envelope { data, message, instructions }
   │ broker forwards (when data is set) ↓
   ▼
 POST /api/agent/toolResult  ── store by sessionId + publish on session:<id>
   ▼
 GuiPanel ── getPlugin(toolName).viewComponent renders selectedResult
   │ user submits → sendTextMessage(text)
   ▼
 Terminal.sendText(text) then delayed "\r"  ── types it into the PTY = next user turn
```

### Findings (after Phase III)

Status: **built (vue-tsc + vite), lint-clean, and tested end-to-end via an MCP
client** — `tools/list` returns the two config-driven tools; `tools/call`
`presentDocument`/`presentForm` flow through the per-plugin REST routes and the
broker into the toolResult store; `GET /api/agent/toolResults/:id` replays both;
re-POSTing a result's `uuid` upserts (no duplicate) with `viewState` preserved;
flipping `plugins.json` to `["markdown"]` drops `presentForm` from both the tool
list and `--allowedTools`. Driving the form's PTY-typed answer from a **real
interactive `claude`** is the remaining manual check (the unit under it —
`Terminal.sendText` over `/ws` — is the same input path the keyboard already uses).

- **Config-driven loading without codegen.** MulmoClaude self-registers plugins via
  `_generated/*` barrels (`scripts/codegen-plugin-barrels.ts`). The spike skips that:
  the server uses dynamic `import()` over the `enabled` list; the frontend uses Vite
  `import.meta.glob("../plugins/*/index.ts", { eager:true })` filtered by the same
  JSON. Same outcome (drop a dir + name it in the config → it loads), far less
  plumbing. `tsconfig.app.json` had to add `plugins/**/*.{ts,vue}` to `include` and
  `resolveJsonModule` for the config import.
- **Why deleting the long-poll is the important part.** It was the one piece of the
  spike with **no MulmoClaude analogue**. Replacing it with PTY-typed feedback means
  the spike now exercises the *actual* GUI→LLM mechanism the migration depends on,
  and removes ~70 lines of parked-response/timeout bookkeeping.

---

## Decision: permissions are terminal-native

We will **not** intercept permission prompts into the GUI. Because the chat is a
real terminal, Claude's built-in "May I?" prompt renders right there and the user
answers it in the terminal — simpler, and better than a GUI dialog. This **retires
the old R1 risk by choice** (no probe needed) and **removes work** from
MulmoClaude's M3:

- Drop the `handlePermission` MCP tool and all `--permission-prompt-tool` wiring.
- Drop the `AskUserQuestion → presentForm` redirect — in interactive mode
  `AskUserQuestion` renders natively in the terminal and the user answers there.

**One caveat — sessions with no terminal attached.** Terminal-native permissions
work for any session a human will eventually view:

- **foreground chat** → prompt in the terminal, user answers;
- **visible background chat** → the prompt simply waits in its terminal until the
  user opens the session (fits the existing "needs attention" model).

But a **fully hidden worker** (`spawnBackgroundChat hidden=true`) or an
**autonomous mobile-spawned** session has no terminal for anyone to answer at, so
a prompt would block forever. Those must run with **pre-authorized tools** (broad
`--allowedTools` / a permissive settings profile) so they never stop to ask.
Decide that pre-auth policy as part of MulmoClaude M5/M6.

## Out of scope

Docker sandbox, roles, durable persistence, mobile input, sidebar preview
thumbnails (`previewComponent`), codegen plugin barrels, and any MulmoClaude code
changes. (Multiple config-loaded plugins moved **into** scope in Phase III.) This
spike is to **learn the seam and grow a faithful base**; the real work lands on
MulmoClaude's `staging` branch afterward.

## What this de-risks for MulmoClaude

Phase I + II (validated against a real interactive `claude`) turn MulmoClaude
milestone **M3 (plugins + GUI chat protocol)** from "invent it on the integration
branch" into "port a proven pattern" — they confirm the GUI survives the
interactive PTY, the load-bearing assumption of the entire migration. With
permissions decided terminal-native (above), M3 has no open risks and the
`staging` migration can begin.

**Phase III** raises the fidelity: the spike now mirrors MulmoClaude's *actual*
protocol — config-driven plugins, the toolResult model, per-plugin REST + broker,
and PTY-typed GUI→LLM feedback. The earlier mis-port (M3 first carried the spike's
stripped-down shapes and had to be redone) is exactly what this prevents: the port
target is now structurally the same as the destination, so M3 becomes closer to
copy-paste than translation.
