# mulmoterminal

A browser-based terminal for running [Claude Code](https://claude.com/claude-code)
sessions, with a sidebar that lists the current project's chat sessions and shows
live, hook-driven activity for each one.

Each session runs as a real PTY on the server (`claude` in a pseudo-terminal) and
is streamed to an [xterm.js](https://xtermjs.org/) terminal in the browser over a
WebSocket. A sidebar lists every Claude session for the project and reflects, in
real time, which sessions are **working** (Claude is thinking) and which **need
attention** (waiting for input, or finished with output you haven't seen).

**Inserting a file path** — like a native terminal, you can put a file's absolute
path into the prompt: **drag a file** onto the terminal (works where the browser
exposes the path via `file://` — Firefox/Safari), or click the **📎 file button**
in the terminal header, which asks the local server to open the OS file dialog and
inserts the chosen path (works in every browser, including Chrome). The path is
inserted at the cursor — it is not submitted, so you can review it first.

---

## Install & run

Requires the [`claude`](https://claude.com/claude-code) CLI on your `PATH` and
**Node ≥ 22.9**.

```bash
npx mulmoterminal           # start on http://localhost:34567 and open the browser
# or install globally:
npm install -g mulmoterminal
mulmoterminal
```

A global install isn't auto-updated, so on startup MulmoTerminal checks npm and
prints a one-line notice when a newer version is available (`npm i -g mulmoterminal`
to update). Disable with `MULMOTERMINAL_NO_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER=1`).

Options: `--cwd <dir>` (working directory — relative paths allowed; defaults to the
directory you run the command from), `--port <n>` (default 34567), `--no-open`,
`--version`, `--help`.

```bash
npx mulmoterminal --cwd ./my-project   # work in a specific directory
```

The published package ships the server (run via `tsx`) plus the pre-built web UI;
`npx mulmoterminal` checks for the `claude` CLI, picks a free port, starts the
server, and opens the browser. For local development from a clone, see
[Running](#running).

---

## Contents

- [Architecture](#architecture)
- [Why a PTY?](#why-a-pty)
- [Tech stack](#tech-stack)
- [Configuration](#configuration)
- [Running](#running)
- [Scripts (Run menu)](#scripts-run-menu)
- [Server API specification](#server-api-specification)
  - [HTTP: `GET /api/sessions`](#http-get-apisessions)
  - [HTTP: `GET /api/scripts`](#http-get-apiscripts)
  - [HTTP: `POST /api/hook`](#http-post-apihook)
  - [WebSocket: `/ws` (terminal)](#websocket-ws-terminal)
  - [WebSocket: `/ws/run` (command terminal)](#websocket-wsrun-command-terminal)
  - [Socket.IO: `/ws/pubsub` (activity pub/sub)](#socketio-wspubsub-activity-pubsub)
- [Session model](#session-model)
- [Session lifecycle](#session-lifecycle)
- [Claude hook injection](#claude-hook-injection)
- [Session discovery & titles](#session-discovery--titles)
- [Project structure](#project-structure)
- [Testing](#testing)

---

## Architecture

```
┌──────────────────────────────────────┐         ┌─────────────────────────────────────────────┐
│ Browser (Vue 3 + xterm.js)            │         │ Server (Express + Node)                       │
│                                       │         │                                               │
│  Sidebar.vue ──subscribe("sessions")──┼──SIO───►│  socket.io  /ws/pubsub   ── publish ──┐       │
│      ▲  refetch on any push           │         │                                       │       │
│      └──── GET /api/sessions ─────────┼──HTTP──►│  Express   /api/sessions              │       │
│                                       │         │            /api/hook  ◄──curl── hooks │       │
│  Terminal.vue ── ws JSON msgs ────────┼──WS────►│  ws        /ws  ──► node-pty ─► `claude`──hooks┘
│      (input / resize / output)        │         │                     (one PTY per session)     │
└──────────────────────────────────────┘         └─────────────────────────────────────────────┘
```

- **Terminal I/O** flows over a raw WebSocket (`/ws`), one PTY per session.
- **Session list** is fetched over HTTP (`/api/sessions`).
- **Live activity** is pushed over a Socket.IO pub/sub channel (`/ws/pubsub`);
  the server learns of activity from **Claude hooks** that POST to `/api/hook`.
- **Script commands** (`yarn dev`, tests, …), launched from a cell's directory
  picker, run in their own ephemeral PTY over a separate WebSocket (`/ws/run`);
  they are not Claude sessions. See [Scripts (Run menu)](#scripts-run-menu).
- In dev (`yarn dev`) the Vite dev server runs on its own port (`CLIENT_PORT`,
  default `6856`) and proxies `/ws` (covers `/ws/run`), `/ws/pubsub`, and `/api` to
  the backend (`PORT`, default `34567`) — so you open the Vite port (e.g.
  `http://localhost:6856`). In production the backend serves the built client from
  `dist/` on `PORT`, and you open that.

---

## Why a PTY?

Claude Code's interactive mode renders its UI with [Ink](https://github.com/vadimdemedes/ink)
(a React-based TUI framework), which requires a real **TTY** to be attached. A
plain `child_process.spawn()` provides no TTY, so interactive Claude won't start
(it stays silent). [node-pty](https://github.com/microsoft/node-pty) allocates a
real **pseudo-terminal** at the OS level, so from Claude's point of view it's
running in an ordinary terminal — full TUI rendering, cursor movement, colors,
and tool-approval prompts all work. We don't use `-p`/headless mode or the Agent
SDK; we drive the real interactive CLI and relay its TTY over the WebSocket.

> **macOS note:** node-pty's bundled `spawn-helper` binary ships without the
> execute bit (mode 644), which causes a `posix_spawnp failed` error. The
> `postinstall` script (`server/fix-pty-perms.js`) fixes it to 755 automatically.

---

## Tech stack

| Layer    | Technology |
| -------- | ---------- |
| Frontend | Vue 3 (`<script setup>` + TypeScript), Vite, xterm.js (`@xterm/*`), socket.io-client |
| Backend  | Node (ESM, TypeScript run via `tsx`), Express 5, `ws` (terminal WebSocket), `node-pty`, socket.io |
| Tests    | Vitest + @vue/test-utils + jsdom |

Requires **Node ≥ 22.9** (uses `node --env-file-if-exists`) and the `claude` CLI on `PATH`.

---

## Configuration

The server is configured entirely through environment variables, optionally
loaded from a `.env` file via `node --env-file-if-exists=.env` (wired into the
npm scripts). The `.env` is optional — every variable below has a default, so
the server runs without one.

| Variable     | Default        | Description |
| ------------ | -------------- | ----------- |
| `PORT`        | `34567`        | Backend HTTP/WebSocket port (prod: the URL you open). |
| `CLIENT_PORT` | `6856`         | Vite dev-server port (dev only: the URL you open with `yarn dev`). |
| `CLAUDE_BIN` | `claude`       | The Claude Code binary to spawn. |
| `CLAUDE_CWD` | current dir    | Working directory each `claude` PTY runs in; determines which project's sessions the sidebar lists. Via `npx mulmoterminal` it defaults to the directory you ran the command from (override with `--cwd <dir>`, relative allowed); when the server is run directly it falls back to `~/mulmoclaude`. A value read from `.env` must be an absolute path (`~` is not expanded). |

Example `.env` (gitignored):

```
CLAUDE_CWD=/Users/you/my-project
```

### UI settings (`~/.mulmoterminal/config.json`)

The Settings modal (⚙) persists per-user UI choices to `~/.mulmoterminal/config.json`
(read/written via `GET`/`POST /api/config`):

| Field        | Meaning |
| ------------ | ------- |
| `cwdPresets` | Quick-pick directories offered when launching a terminal. |
| `soundFile`  | Absolute path to a custom **attention sound** (played when a session needs attention). Empty/unset uses the built-in synthesized chime. |

**Attention sound.** The default chime is generated with the Web Audio API — **no
audio file is bundled**, so the npm package stays light and has no media-licensing
concerns. To use your own sound, set `soundFile` in Settings (Browse / Test / Use
chime) or in the config file; the server streams that file at `GET /api/sound` and
the client decodes it (falling back to the chime if it's missing or not audio). It's
your own local file referenced by absolute path — nothing is added to the package.

---

## Running

```bash
yarn install            # postinstall fixes node-pty prebuilt binary perms

yarn dev                # backend (:34567) + Vite UI (:6856), concurrently — open http://localhost:6856
# or individually:
yarn dev:server         # backend only  (node --import tsx --env-file-if-exists=.env server/index.ts)
yarn dev:client         # Vite dev server only

yarn build              # type-check (vue-tsc) + vite build -> dist/
yarn typecheck:server   # type-check the server (tsconfig.server.json)
yarn server             # run backend; serves dist/ + the APIs on :34567
yarn test               # vitest run
```

The backend is TypeScript run directly via `tsx` (no build step); `server/` is
type-checked separately through `tsconfig.server.json` (`strict`), kept out of
the main `build` so the two type-check independently.

In dev, open the Vite URL; its proxy forwards `/ws`, `/ws/pubsub`, and `/api` to
`:34567`. In production, run `yarn build` then `yarn server` and open
`http://localhost:34567`.

---

## Scripts (Run menu)

An empty grid cell's launcher (the directory picker) offers a **run a script** row
that launches project scripts (a dev server, tests, a build, …) **in that cell, in
the directory the cell is pointed at** — so a whole workflow lives in one window
alongside the Claude sessions. Scripts are **per-directory**: the cell reads the
`script.json` of whatever directory you select, so different cells can offer
different projects' scripts.

Every running terminal's header also has a **▶ Run ▾** dropdown (next to the
connection status), in both the single view and each grid cell — but **only when the
open project has scripts** (no `script.json`, no button). It lists the **open
project's** `script.json` — the directory that terminal runs in — and launches the
picked script in a **spare grid cell** (reusing an open launcher, else a new one),
switching to the grid from the single view so you can watch it. So you can start a
dev server or tests for the project you're working in without disturbing the
session that's running.

The list is populated from a **`script.json`** at the chosen directory's root. It's
optional; a directory without one simply shows no scripts.

```jsonc
// <dir>/script.json
{
  "scripts": [
    { "label": "Dev server", "command": "yarn dev" },
    { "label": "Unit tests", "command": "yarn test" },
    { "label": "Build", "command": "yarn build" },
    // optional per-script working dir (relative to this file, or absolute):
    { "label": "Sub server", "command": "yarn serve", "cwd": "packages/server" }
  ]
}
```

| Field     | Required | Meaning |
| --------- | -------- | ------- |
| `label`   | yes      | What the launcher shows. |
| `command` | yes      | Shell command, run via the login shell (`$SHELL -lc "<command>"`). |
| `cwd`     | no       | Working dir, relative to `script.json` or absolute. Defaults to the cell's directory. |

A command terminal is **not** a Claude session: it has no session id, no hooks, no
transcript, and **isn't persisted** — it's ephemeral, so a page reload drops it and
closing the cell (or reloading) kills the process. When the command exits, the cell
offers a **↻ re-run**. The browser only ever sends the script's **index** + its
directory; the server reads that directory's `script.json` and resolves the
command, so the file is the allowlist of what can run.

---

## Server API specification

Base URL: `http://localhost:$PORT` (default `http://localhost:34567`).

### HTTP: `GET /api/sessions`

Lists the most-recent chat sessions for the current project (`CLAUDE_CWD`),
newest first, including freshly-created sessions that aren't yet written to disk.

**Response `200 application/json`**

```jsonc
{
  "cwd": "/Users/you/my-project",
  "sessions": [
    {
      "id": "d16f43f3-ef63-4a5e-b273-debaccb3522a", // session UUID (= .jsonl basename)
      "title": "Review available skills list",        // see "Session discovery & titles"
      "mtime": 1781471064511.22,                       // last-modified, ms epoch (sort key)
      "working": false,                                // Claude is mid-turn (blue dot)
      "waiting": false                                 // needs attention (bold)
    }
    // ...
  ]
}
```

- Sessions are read from `~/.claude/projects/<encoded CLAUDE_CWD>/*.jsonl` and
  merged with in-memory sessions started this run but not yet persisted (those
  have `title: "New session"` and `mtime` = creation time).
- Sorted by `mtime` descending and capped at the **50** most recent. Files are
  ranked by a cheap `stat`-only pass; only the top 50 are read and parsed for
  titles, so the endpoint stays cheap regardless of how many sessions exist.
- `500 { "error": string }` on an unexpected filesystem error. A missing project
  directory is **not** an error — it yields an empty `sessions` array.

### HTTP: `GET /api/scripts`

The runnable entries from `<cwd>/script.json` for a cell's chosen directory
(`?cwd=<dir>`, falling back to `CLAUDE_CWD`); see
[Scripts (Run menu)](#scripts-run-menu). The resolved `cwd` is echoed back (the
server may fall back from a bad path), and each entry carries its `index` (the
position the client sends back to `/ws/run`).

```jsonc
// GET /api/scripts?cwd=/Users/me/proj
{
  "cwd": "/Users/me/proj",
  "scripts": [
    { "index": 0, "label": "Dev server", "command": "yarn dev" },
    { "index": 1, "label": "Sub server", "command": "yarn serve", "cwd": "packages/server" }
  ]
}
```

A missing or invalid `script.json` is **not** an error — it yields an empty
`scripts` array.

### HTTP: `POST /api/hook`

**Internal endpoint.** Claude hooks (injected per session — see
[Claude hook injection](#claude-hook-injection)) POST their event payload here.
You normally don't call this yourself.

**Request `application/json`** — the Claude hook payload; only these fields are used:

```jsonc
{
  "session_id": "d16f43f3-...",        // the session the event is for
  "hook_event_name": "UserPromptSubmit" // "UserPromptSubmit" | "Stop" | "Notification"
}
```

Effect (see [Session model](#session-model)):

| `hook_event_name`  | Effect |
| ------------------ | ------ |
| `UserPromptSubmit` | `working = true` for the session. |
| `Stop`             | `working = false`; if the session is **backgrounded**, also `waiting = true`. |
| `Notification`     | If the session is **backgrounded**, `waiting = true`. |

Any resulting state change is published on the `sessions` pub/sub channel.

**Response `200 application/json`**: `{ "ok": true }` (always, even for unknown events).

### WebSocket: `/ws` (terminal)

A raw WebSocket carrying the terminal stream for one session. One PTY per
connection (or reattach to an existing background PTY).

**Connect**

- `ws://host/ws` — start a **new** session (server generates a UUID and spawns
  `claude --session-id <uuid> --settings <hooks>`).
- `ws://host/ws?session=<id>` — **resume/reattach** a session. If a live
  background PTY exists for `<id>`, the socket reattaches to it (and its recent
  output buffer is replayed); otherwise the server spawns
  `claude --resume <id> --settings <hooks>`.

**Server → client** (JSON text frames):

| Message | Meaning |
| ------- | ------- |
| `{ "type": "session", "id": string }` | Sent immediately on connect — the session id this socket is bound to (lets the client learn a new session's generated id). |
| `{ "type": "output", "data": string }` | PTY output to write to the terminal. On reattach, the first `output` frame is the replayed tail buffer (≤ 64 KB). |
| `{ "type": "exit", "exitCode": number, "signal": number }` | The `claude` process exited; the socket then closes. |

**Client → server** (JSON text frames):

| Message | Meaning |
| ------- | ------- |
| `{ "type": "input", "data": string }` | Keystrokes / bytes to write to the PTY. |
| `{ "type": "resize", "cols": number, "rows": number }` | Resize the PTY. |

A non-JSON frame is written to the PTY verbatim (fallback).

**Disconnect** — when the socket closes, if Claude is still `working` the PTY is
**kept alive** in the background; otherwise it's killed. See
[Session lifecycle](#session-lifecycle).

### WebSocket: `/ws/run` (command terminal)

A raw WebSocket carrying a one-off **Run-menu command** (see
[Scripts (Run menu)](#scripts-run-menu)) — a plain shell PTY, **not** a Claude
session, so there's no `session` message, no hooks, and no reattach.

**Connect**

- `ws://host/ws/run?index=<n>&cwd=<dir>` — run the script at position `<n>` in
  `<dir>/script.json` (cwd falls back to `CLAUDE_CWD`). The server reads that
  file and spawns `$SHELL -lc "<command>"` in the script's `cwd`. An out-of-range
  index (or a missing/invalid `script.json`) yields
  `{ "type": "error", "message": string }` and the socket closes.

The **output / input / resize / exit** frames are identical to `/ws`. There is no
`session` frame.

**Disconnect** — the terminal is **ephemeral**: when the socket closes (cell
closed, or page reloaded) the process is **killed**. There is no background
survival and no resume.

### Socket.IO: `/ws/pubsub` (activity pub/sub)

A minimal Socket.IO pub/sub for live session-activity updates. Channel names are
Socket.IO rooms.

- **Path**: `/ws/pubsub`, transport: `websocket`.
- **Client → server events**:
  - `subscribe` with a channel name (string) → join the room.
  - `unsubscribe` with a channel name (string) → leave the room.
- **Server → client event**: `data` with `{ channel: string, data: <payload> }`.

**Channel `"sessions"`** — payloads describe a single session change:

```jsonc
// activity change (working/waiting flipped)
{ "id": "d16f43f3-...", "working": false, "waiting": true, "event": "Stop" }

// a brand-new session was created
{ "id": "…", "working": false, "event": "created" }

// a session's PTY was closed/reaped
{ "id": "…", "working": false, "event": "closed" }
```

`event` is the originating hook (`UserPromptSubmit` | `Stop` | `Notification`) or
a lifecycle marker (`created` | `closed` | `null`). The client treats **any**
`sessions` message as a signal to refetch `GET /api/sessions` (the server is the
single source of truth for the list), so payload details are advisory.

---

## Session model

Per-session state lives on the server (`activity` map) and is surfaced as two
booleans on every session record:

| Flag      | Set when | Cleared when | UI |
| --------- | -------- | ------------ | -- |
| `working` | `UserPromptSubmit` hook fires (Claude started a turn) | `Stop` hook fires (turn finished) | **Blue dot** next to the title |
| `waiting` | A **background** session fires `Notification` (waiting for input — permission / question / idle) **or** `Stop` (finished, output unseen, ready for another message) | The session is brought to the **foreground** (a WebSocket attaches to it) | **Bold** title |

"Foreground" = a session that currently has an attached terminal WebSocket (the
one you're viewing). `waiting` is only ever set for **background** sessions,
because a foreground session is already on screen.

---

## Session lifecycle

```
        new ws /ws                         ws /ws?session=<id>
            │                                      │
            ▼                                      ▼
   generate UUID, spawn               live bg PTY?  ──yes──►  reattach + replay buffer
   claude --session-id <uuid>              │ no
   register "New session",                 ▼
   publish "created"               spawn claude --resume <id>
            │                                      │
            └───────────────┬──────────────────────┘
                            ▼
                   attached (foreground)  ── setWaiting(false) ──► not bold
                            │
              ws close (switch away / disconnect)
                            │
            ┌───────── working? ──────────┐
           yes                            no
            │                             │
   keep PTY alive (background)        kill PTY (reap), publish "closed"
            │
   Stop hook in background:
   waiting=true (bold), working=false, reap PTY
   (flag persists via on-disk record → stays listed & bold until viewed)
```

Key rules:

- **Switching away never interrupts Claude mid-turn** — a `working` session's PTY
  survives in the background.
- A background session that goes **idle** (`Stop`) is **reaped** (killed). If it
  finished with unseen output, its `waiting` flag persists via the on-disk
  session record, so it stays listed and **bold** until you open it.
- **Reattach over respawn**: selecting a session that still has a live background
  PTY reattaches to it (replaying a ≤ 64 KB output tail) instead of spawning a
  duplicate `claude`.
- **One live viewer per session**: a session is bound to a single socket. Opening
  it in a second place (another tab, or another grid cell pointed at the same dir)
  reattaches there and **supersedes** the first, which detaches. To avoid doing
  this by accident, a grid launcher's resume list **flags rows already open in
  another terminal** (`● open`) and **asks for confirmation** before taking one
  over.
- Brand-new sessions appear in the sidebar **immediately** (before their `.jsonl`
  exists) via the in-memory `knownSessions` registry + a `created` push; an
  unused one disappears when its PTY is reaped.

---

## Claude hook injection

Activity is detected via Claude Code hooks injected **per spawn**, without
touching the user's `~/.claude/settings.json` or project settings. The server
passes `claude --settings '<json>'` where the JSON registers a command hook for
`UserPromptSubmit`, `Stop`, and `Notification`, each of which pipes the hook
payload to the server:

```jsonc
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "curl -s -X POST http://localhost:$PORT/api/hook -H 'content-type: application/json' -d @-" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "curl … -d @-" }] }],
    "Notification":     [{ "hooks": [{ "type": "command", "command": "curl … -d @-" }] }]
  }
}
```

Because the server spawns each new session with `--session-id <uuid>`, it always
knows the live session's id — even before the session's `.jsonl` file exists.

---

## Session discovery & titles

Claude stores each project's sessions as JSONL files under
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, where the absolute `cwd`
has its `/` and `.` characters replaced with `-` (e.g.
`/Users/you/proj` → `-Users-you-proj`).

A session's display **title** is derived by scanning its JSONL for, in order of
preference:

1. the latest `ai-title` record's `aiTitle`,
2. else the latest `last-prompt` record's `lastPrompt`,
3. else the first real user message (slash/local-command wrappers like
   `<local-command-…>` are skipped),
4. else `"(untitled session)"`.

In-memory sessions not yet persisted show as `"New session"` until their file
appears, at which point the on-disk title takes over.

---

## Project structure

```
server/
  index.js        Express app, /api routes, terminal WebSocket, PTY lifecycle,
                  session state, hook injection, session discovery; also
                  /api/scripts + the /ws/run command-terminal relay
  scripts.ts      Loads/validates script.json; resolves a Run-menu command by index
  pubsub.js       createPubSub(server) — socket.io pub/sub at /ws/pubsub
  fix-pty-perms.js  postinstall: fixes node-pty prebuilt binary permissions
src/
  App.vue         Layout (sidebar + terminal); owns the active session id
  components/
    Sidebar.vue       Session list; working dot + waiting bold; pub/sub driven
    Sidebar.spec.ts   Vitest component tests
    Terminal.vue      xterm.js terminal; /ws (or /ws/run); single-view ▶ Run menu
    AppToolbar.vue    Shared header (single + grid); grid-only ＋ Terminal + ⇅/↔ cell-order toggle
    GridView.vue      Grid view: auto-layout, pages, manual/auto cell order; runs handed-off scripts
    RunMenu.vue       ▶ Run dropdown: lists a dir's script.json, emits the pick
    TerminalCell.vue  A cell: Claude launcher (dir picker + resume + run-a-script); ◀▶ to reorder
    TerminalGrid.vue  Grid of cells; auto-sizes by count; zoom lines up every tab
    CommandCell.vue   A grid cell that runs a script.json command (ephemeral)
  composables/
    usePubSub.ts      socket.io-client pub/sub composable (subscribe/unsubscribe)
    usePendingScript.ts  Hands a header-picked script to the grid to run
vite.config.ts    Dev proxy for /ws (covers /ws/run), /ws/pubsub, /api
vitest.config.ts  jsdom test environment
```

---

## Testing

```bash
yarn test
```

`src/components/Sidebar.spec.ts` covers the sidebar: rendering the server's
session list, the working dot, the `waiting` bold state, refetching on a pub/sub
push, and emitting `select` on click. The pub/sub composable and `fetch` are
mocked so the tests run without a server.
