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
  - [HTTP: `POST /api/command/summarize`](#http-post-apicommandsummarize)
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

## Session persistence (tmux)

If **`tmux` is installed**, MulmoTerminal runs each Claude session and launcher inside
a tmux session, so **a server crash or restart doesn't kill your terminals** — the
processes keep running and reattach when the server comes back (like `screen`/`tmux`).
A long build, a dev server, or a mid-turn Claude session all survive `node --watch`
reloads and crashes. It uses its **own** tmux server (`-L mulmoterminal`) and config, so
it never touches your personal tmux sessions or keybindings.

**No tmux? No problem** — terminals fall back to plain (non-persistent) PTYs, exactly as
before. An explicit close (a cell's ✕) ends the tmux session; a machine reboot does not
survive (tmux itself is gone). Command-cell scripts are ephemeral and not persisted.

---

## Docker sandbox (experimental, single view)

Set **`MULMOTERMINAL_SANDBOX=1`** (and have Docker running) to run the **single-view**
Claude session inside a container instead of on the host, while Claude still reaches the
app's GUI MCP + activity hooks over `host.docker.internal`. The `mulmoterminal-sandbox`
image is **built automatically** on first launch from the shipped `Dockerfile.sandbox`
(~1 min, once; rebuilt only when that file changes). Override the name with
`MULMOTERMINAL_SANDBOX_IMAGE`. If the image can't be built (e.g. Docker down), the session
falls back to the host spawn — no cryptic failure.

This **contains** Claude — it can't reach the host filesystem outside the mounts, host
processes, or arbitrary host ports. It is **not full isolation**: the **workspace** and
**`~/.claude`** are bind-mounted **read-write** by design (so Claude edits your project,
and transcripts interoperate with host sessions), so those specific paths stay mutable
from inside. The sandbox is **non-persistent** (the container is
`--rm`, tied to the session), **opt-in and single-view only** — the grid keeps its host +
tmux path, and with the flag unset (or Docker unavailable) everything runs on the host
exactly as before. **macOS only** for now — on Linux (bind-mount uid ownership) and
Windows (host paths aren't valid Linux container paths) it falls back to the host spawn;
both are follow-ups. Adding arbitrary user MCP servers to the sandbox is in progress
(see #202).

**Authentication (macOS).** Claude's live login token lives in the macOS **Keychain**,
which the container can't read (mounting `~/.claude` alone isn't enough — its
`.credentials.json` is often absent or stale). On each sandbox spawn MulmoTerminal exports
the current credential to a per-session `~/.mulmoterminal/sandbox/creds-<id>.json`
(mode `0600`, removed when the session ends) and mounts it **read-only** over the
container's `~/.claude/.credentials.json`; your host `~/.claude` is never modified. If
you've never logged in on the host, run `claude` once first — otherwise the server logs a
warning and the container shows "Not logged in".

**Host credentials (opt-in).** By default the sandbox has no host credentials. To let the
sandboxed Claude use `gh`/`git`, set **`SANDBOX_MOUNT_CONFIGS=gh,gitconfig`** — a **fixed
allowlist** (you pick names, never arbitrary paths): `gh` mounts `~/.config/gh` read-only
and passes a `GH_TOKEN` (from `gh auth token`, since macOS keeps it in the Keychain), and
`gitconfig` mounts `~/.gitconfig` read-only. Set **`SANDBOX_SSH_AGENT_FORWARD=1`** to
forward the SSH agent socket (the keys never enter the container). Both are read only when
building the sandbox spawn, so they have no effect unless `MULMOTERMINAL_SANDBOX` is on.

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
| `prRepos`    | `owner/repo` entries whose open PRs/issues the cross-repo **PRs & Issues** view aggregates (via your `gh` login). |
| `launchers`  | `{ label, command }` entries offered in a grid cell's launcher besides Claude — a plain shell, `codex`, any interactive command. |
| `userMcpServers` | `{ id, url }` HTTP MCP servers merged into the **single-view** Claude session's `--mcp-config` (a `localhost` URL is reached over `host.docker.internal` in the Docker sandbox). Takes effect on the next session. |

**Attention sound.** The default chime is generated with the Web Audio API — **no
audio file is bundled**, so the npm package stays light and has no media-licensing
concerns. To use your own sound, set `soundFile` in Settings (Browse / Test / Use
chime) or in the config file; the server streams that file at `GET /api/sound` and
the client decodes it (falling back to the chime if it's missing or not audio). It's
your own local file referenced by absolute path — nothing is added to the package.

### Per-directory settings (`<project>/.mulmoterminal.json`)

Drop a `.mulmoterminal.json` in a project directory to give terminals opened **in
that directory** their own look and sound. It applies per terminal (per grid cell) —
the rest of the app keeps your chosen theme — and a directory's theme overrides your
manual theme pick for that terminal only. Every field is optional; a missing or
malformed file is ignored.

```jsonc
{
  "name": "PROD · payments",            // badge shown on this directory's terminals
  "badgeColor": "#cf222e",              // badge color (hex #rrggbb)
  "headerColor": "#190a23",             // cell header background (hex #rrggbb)
  "headerTextColor": "#ffffff",         // cell header text color (hex #rrggbb)
  "cellColor": "#101014",               // cell body background (hex #rrggbb)
  "cellBorderColor": "#2a2a4e",         // cell border color (hex #rrggbb)
  "dotColor": "#00e676",                // idle status dot (hex #rrggbb)
  "buttonColor": "#c7cdf0",             // header icon buttons (hex #rrggbb)
  "theme": "nord",                      // terminal palette: midnight | nord | daylight | solarized
  "colors": { "background": "#190a23", "cursor": "#ff2e63" }, // per-key palette overrides
  "sound": "./.mulmoterminal/alert.mp3" // attention sound, RELATIVE to this directory
}
```

| Field        | Meaning |
| ------------ | ------- |
| `name`       | Label shown as a badge in the terminal/cell header. |
| `badgeColor` | Badge background color (`#rrggbb`); text auto-contrasts. |
| `headerColor` | Cell header **background** color (`#rrggbb`). While a terminal is working/blocked the status tint still shows; the custom color applies when idle. |
| `headerTextColor` | Cell header **text** color (`#rrggbb`) — the dir path and prompt. |
| `cellColor` | Cell **body background** color (`#rrggbb`) — the frame around the terminal. |
| `cellBorderColor` | Cell **border** color (`#rrggbb`). The status frame (working/blocked) still overrides it while active. |
| `dotColor` | **Idle** status-dot color (`#rrggbb`). The working/waiting colors are unchanged so the activity signal stays intact. |
| `buttonColor` | Header **icon button** color (`#rrggbb`) — expand / close / etc. |
| `theme`      | xterm palette for terminals in this directory (one of the built-in theme ids). |
| `colors`     | Per-key xterm palette overrides applied on top of `theme` (or the app theme when `theme` is unset). Keys are xterm `ITheme` names (`background`, `foreground`, `cursor`, `selectionBackground`, the 16 ANSI colors, …); values are hex (`#rgb` / `#rrggbb` / `#rrggbbaa`). Unknown keys / bad values are dropped. |
| `sound`      | Attention sound for this directory's sessions, a path **relative to the directory** (served at `GET /api/dir-sound`). |

**Security.** `sound` is a directory-relative path only — absolute paths and any
`../` that escapes the directory are rejected, and the path is never taken from the
HTTP request, so an opened project can't point the player at arbitrary files.
Changes take effect when the terminal is next opened (no live file watch).

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

The same launcher also has an **or launch** row for your configured **launch commands**
— a plain interactive shell, `codex`, any command — set in Settings (⚙) → **Launch
commands** as `{ label, command }` (e.g. `Shell` → `$SHELL`, `Codex` → `codex`). Unlike
a one-shot script, a launcher runs as a **persistent terminal in the cell's directory**:
it survives grid page switches and reconnects, and its dot shows running vs. exited (it
has no Claude hooks, so no blocked/done states).

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

Each command cell also has a **✦ Summarize** button: click it to send the cell's
captured output to `claude -p` (headless) and get a short **Errors / Warnings /
likely cause / suggested fix** note in a panel — handy when a build or install
buries the one failing line in thousands. It's manual (never auto-runs) and analyzes
the last 32 KB of output. See
[`POST /api/command/summarize`](#http-post-apicommandsummarize).

---

## Files view (browse & edit)

Every terminal header has a **📁 Files** button that opens a full-screen file explorer
rooted at **that terminal's project directory** — so after Claude says "wrote `foo.md`"
you can jump straight there to read or edit it. The left pane is a lazy-loaded directory
tree; clicking a file opens it in a **CodeMirror** editor (Markdown / JS-TS / JSON
highlighting, everything else as plain text). Markdown files get a **Preview** toggle
that renders via the server's sandboxed `…/md` HTML. **Save** (or ⌘/Ctrl-S) writes back.

All reads and writes go through `GET/PUT /api/files/browse/*?cwd=&path=`, and every
`path` is **contained within the project root** (server-side) — `..`/absolute escapes
are rejected for reads and writes alike, so editing can't reach outside the directory
the terminal is pointed at.

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

### HTTP: `POST /api/command/summarize`

Runs `claude -p` **headless** over a command cell's captured terminal output and
returns a short summary (Errors / Warnings / likely cause / suggested fix). Backs the
**✦ Summarize** button on a Run cell (see [Scripts (Run menu)](#scripts-run-menu)).
The browser sends the cell's xterm buffer as `log`; the server truncates it to the
last **32 KB** (the tail, where errors + the exit line live), runs the CLI with the
log piped on stdin (argv — no shell), and returns its answer. Same-origin guarded.

**Request `application/json`**:

```jsonc
{ "log": "npm ERR! cannot find module 'foo'\n..." }
```

**Response `200 application/json`**:

```jsonc
{
  "summary": "Errors: cannot find module 'foo'\nSuggested fix: run `yarn add foo`",
  "truncated": false // true when the log exceeded 32 KB and only the tail was analyzed
}
```

Empty output returns a `{ summary }` note rather than calling the CLI. Errors:
`400` (missing `log`), `403` (disallowed origin), `502` (the `claude` run failed).

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
    useUnloadGuard.ts  Confirm before closing/reloading the tab while a terminal is live
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
