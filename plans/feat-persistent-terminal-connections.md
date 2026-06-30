# Plan: Keep PTYs alive by persisting terminal connections client-side

## Problem

When the user navigates away from the terminal UI for a while and comes back,
Claude Code warns that restoring the session will consume a lot of tokens. This
happens because:

1. Navigating away (or flipping to an off-page grid tab, or switching the whole
   view) **unmounts** `Terminal.vue`, whose `onUnmounted` closes the WebSocket.
2. The server treats a socket close as a detach and arms the reap grace timer
   (`armReapForDetached`): idle = 30s, waiting = 30min, working = never.
3. An **idle** session is reaped after 30s. Coming back then spawns
   `claude --resume <id>`, which replays the transcript from disk and triggers
   the "restoring old session consumes a lot of tokens" warning.

VS Code never shows this because the terminal process and its connection stay
alive across tab switches. We want the same: a session stays connected as long
as it is **logically open**, and only goes cold when explicitly closed or pulled
from history/resume.

## Goal

The backend Claude PTY stays alive (no `--resume`, no token warning, VS Code
parity) for as long as a session's terminal UI is **logically open** — i.e. it
would be re-mounted when the user navigates back, NOT re-opened from the history
list. Concretely, "logically open" = the union of:

- every grid cell that has a session id (the `grid_v2` roster), regardless of
  which page is currently rendered, and
- the single/chat view's currently-active session.

## Key insight (why this is a client-only change)

The server already keeps a PTY alive **for exactly as long as its WebSocket is
open** — `armReapForDetached` only ever fires from `handleClientClose`, i.e. on
socket close. So we do not need any server change: if the client keeps the
socket open while a session is logically open, the server never reaps it, and
remount becomes a `reattachPty` (buffered-scrollback replay), not a `--resume`.

Today the socket lifetime is tied to the **Vue component lifetime**
(`Terminal.vue` opens it in `connect()` on mount, closes it in `onUnmounted`).
The fix is to **decouple socket lifetime from component lifetime** by hoisting
connection ownership into an App-level manager that survives navigation.

## Non-goals (explicitly out of scope)

- **Dirty disappearance** (laptop sleep / crash / network partition leaving a
  half-open zombie socket that pins the PTY until TCP keepalive times out, ~2h).
  This is a **pre-existing** behavior on `main` — it already affects the
  currently-mounted session today. This change widens its blast radius from
  "the mounted page" to "all open tabs", but does not introduce a new failure
  mode. A WS ping/pong heartbeat to tighten that window is a separate, optional
  follow-up and is NOT part of this plan.
- No server-side changes. No roster/heartbeat protocol. No reap-policy changes.
- Command / Run terminals (`/ws/run`, `props.command`) remain ephemeral and
  component-owned exactly as today (their process is unresumable).

## Current architecture (what moves)

`src/components/Terminal.vue` currently owns, per mounted component:

- the `WebSocket` (`ws`) — opened in `connect()` (line ~112), closed in
  `onUnmounted` (line ~347)
- the xterm `Terminal` + `FitAddon` (`term`, `fitAddon`) and the `ResizeObserver`
- reconnect/backoff state (`knownSessionId`, `sawExit`, `disposed`,
  `reconnectAttempts`, `reconnectTimer`, `scheduleReconnect`)
- reactive `status` and `serverCwd`
- the message protocol handling (`output` -> term, `session`/`cwd` -> emits,
  `exit`/`superseded`/`error`)
- input/output plumbing: `term.onData` -> ws, `submitText`, `insertText`,
  `terminate`, resize -> ws

View-only concerns that **stay** in the component: header, voice input
(`useVoiceInput`), drag/drop + `pickFile`, `RunMenu`, theme repaint, the DOM
host element.

Relevant surrounding files:

- `src/components/TerminalCell.vue` — grid cell wrapper; resume picker
  (`loadResumable`/`resume`), `teardown()` -> `terminate()` on the ✕ button.
- `src/components/TerminalGrid.vue` — `v-for`s the active page's cells.
- `src/components/GridView.vue` — owns grid `state`, persists `grid_v2`
  (`watch(state, persist, {deep:true})`); `onClose` -> `closeCell`.
- `src/components/gridTabs.ts` — pure grid state (`cells`, `addCell`,
  `closeCell`, `setSession`, `pageSlice`).
- `src/App.vue` — single view; `activeId` + `connectKey`; renders **either**
  `GridView` **or** the single `TerminalView` via `v-if viewMode`.

## Target architecture

Introduce a singleton **terminal connection manager** created once at App root,
**above** the `v-if` that swaps Grid / single / other views, so it is never
unmounted by navigation.

`src/composables/useTerminalConnections.ts` (new) owns a
`Map<sessionKey, ConnectionEntry>` where each entry holds the durable state:

```
ConnectionEntry {
  ws: WebSocket | null
  term: Terminal
  fitAddon: FitAddon
  host: HTMLDivElement        // xterm is term.open()'d into this ONCE
  resizeObserver: ResizeObserver
  knownSessionId: string | null
  status: Ref<"connecting"|"connected"|"disconnected">
  serverCwd: Ref<string|null>
  // reconnect bookkeeping: attempts, timer, sawExit, superseded
  refs: number               // how many things consider this logically-open
}
```

Manager API (sketch):

- `acquire(opts) -> entry` — create-or-return the entry for a session/cell and
  start `connect()` if not already connected. Increments `refs`.
- `attach(key, mountEl)` — `appendChild` the entry's persisted `host` div into
  the component's mount point and `fit()`. Called from the view component's
  `onMounted` / `onActivated`.
- `detach(key)` — re-parent `host` back to an offscreen holder. Called from the
  view component's `onUnmounted` / `onDeactivated`. **Does NOT close the ws.**
- `release(key)` — decrement `refs`; when it hits 0, close the ws (let the
  server's grace reap it) and dispose the xterm. Called when a session leaves
  the roster (cell closed, or single-mode active session replaced).
- `terminate(key)` — explicit ✕: send `{type:"terminate"}`, close, dispose
  (immediate server reap). Keeps today's behavior.
- `submitText(key, text)`, `insertText(key, text)`, `resize(key)` — route the
  existing operations through the manager by key.

The xterm instance and its `host` div live for the entry's whole lifetime; the
view component merely re-parents `host` in/out of the DOM. This preserves
scrollback, scroll position and selection with **no byte buffering and no
replay** (chosen variant — see below).

### Lifetime rules (when the ws opens / closes)

- **Open** when a session becomes logically open:
  - a grid cell with a session id is created / launched / resumed, or
  - the single view's `activeId` is set to a session.
- **Stay open** across: page flips (off-page grid cells), zoom/filmstrip,
  Grid<->single view toggles, and navigation to non-terminal views
  (e.g. AccountingView). The manager outlives all of these.
- **Close (-> server grace reap)** when a session leaves the roster:
  - grid: `closeCell` drops it from `grid_v2` -> `release`.
  - single: `selectSession`/`newSession` points the active view at a different
    session -> `release` the previous active session (matches today's
    `ws.close()`-on-switch, which lets grace reap rather than terminate).
- **Terminate (-> immediate reap)** on the cell's ✕ button (`teardown`), as today.

### Roster = grid_v2 ∪ single active

The manager does not need a new protocol — the roster is already in the client:
the grid owns `grid_v2`; the single view owns `activeId`. The manager keeps a
connection alive while either references it (`refs`). Because grid and single
views never coexist (App.vue `v-if`), but a session in `grid_v2` is still
logically open while the user is in single view (toggling back re-mounts it
without resume), the manager — living above the toggle — keeps grid sessions
connected regardless of the current view.

## Variant decision: persist the xterm (recommended) vs buffer bytes

**Variant A — persist xterm + its host div in the manager (RECOMMENDED).**
`term.open(host)` is called once; on remount the component appends the existing
`host` element into its container (xterm does not support re-`open()` onto a new
element, so we move the element, not the terminal). Pros: zero replay, preserves
scrollback / scroll position / selection, no client-side buffer to cap, less
total logic (the xterm *is* the buffer). Cons: keeps N live xterm instances in
memory (bounded by scrollback) and requires the DOM re-parenting handoff.

**Variant B — manager owns ws + a capped raw-byte ring buffer; component owns a
fresh xterm each mount.** On unmount: dispose xterm, keep ws; manager appends
`output` to the buffer. On remount: new xterm, write the buffer. Pros: simpler
memory model. Cons: re-implements the server's scrollback replay client-side,
flicker/cost on every remount, loses scroll position + selection, needs a buffer
cap. 

Go with **A**. It's better UX and, because the xterm doubles as the scrollback
store, actually less moving machinery than B.

## Edge cases to preserve

- **`connectKey` / session switch** (`Terminal.vue` watch, line ~255): today a
  user action resets reconnect state and calls `connect()`. Under the manager,
  selecting a new session = `release(old)` + `acquire(new)`; same observable
  behavior.
- **`superseded`** (same session open in another grid cell or browser tab): the
  server kicks the older socket. The manager must mark that entry disconnected
  and NOT reconnect (today's `sawExit` guard). The cell-open-elsewhere warning
  in `TerminalCell` (`sessionOpenElsewhere`) is unaffected.
- **`exit` / `error`**: terminal ends; suppress reconnect; the cell offers a
  re-run. Logic moves to the manager but is unchanged.
- **Command / Run terminals** (`props.command`, `/ws/run`): NOT persisted —
  keep the current component-owned, never-reconnect behavior. The manager only
  persists Claude session terminals.
- **Resize / fit**: the `ResizeObserver` observes the persisted `host` element,
  so it keeps firing correctly across re-parents (it observes the element, not
  its position). On `attach`, call `fit()` + send a `resize` frame.
- **Theme repaint**: `term.options.theme` update on theme/dir change still works;
  the manager holds `term`, the component passes the effective theme on attach
  and on theme-change.
- **GUI -> LLM `submitText`** (`defineExpose`): callers (e.g. GUI message
  submit) invoke by session; route through `manager.submitText(key, text)`. The
  socket-pinning semantics (skip the delayed CR if the socket changed) carry over.

## Implementation steps

1. **Create the manager** `src/composables/useTerminalConnections.ts`: move the
   ws lifecycle, reconnect/backoff, message protocol, xterm + fitAddon +
   ResizeObserver, `status`/`serverCwd`, `knownSessionId`, and `submitText` /
   `insertText` / `terminate` / `resize` out of `Terminal.vue`. Instantiate once
   (provide/inject from App root, or a module-level singleton).
2. **Slim `Terminal.vue`** to a view: keep header, voice, drag/drop, `pickFile`,
   `RunMenu`, theme. On mount, `acquire` + `attach(host into terminalRef)`; on
   unmount, `detach` (NOT close). Read `status`/`serverCwd` from the entry.
   Delegate `submitText`/`terminate` to the manager.
3. **Wire grid lifetime**: `TerminalCell` `acquire`s on launch/resume,
   `attach`/`detach` on mount/unmount, `terminate` on ✕. `GridView.closeCell`
   -> `release`/`terminate` for the dropped session so its socket closes.
4. **Wire single-view lifetime**: `App.vue` `acquire`s the `activeId` session and
   `release`s the previously-active one on `selectSession`/`newSession`. Ensure
   the manager survives the Grid<->single `v-if` toggle (it lives at App root).
5. **Verify off-page persistence**: a grid cell on a non-visible page keeps its
   socket (no reap on page flip) — this falls out of the manager holding the ws
   independent of which cells are mounted.

## Testing / verification

- Start a session, let it go idle (finish a turn), navigate away from the
  terminal view for > 30s, come back: terminal reattaches instantly, **no**
  "restoring session" token warning, scrollback intact (server log shows
  reattach, not `--resume`).
- Grid with > 9 sessions across two pages: sit on page 1 past 30s, flip to
  page 2: page-2 cells are still connected (no cold resume).
- Toggle Grid <-> single view and navigate to AccountingView and back: active
  session stays connected.
- Close a cell (✕): server reaps immediately (today's behavior preserved).
- Switch sessions in single mode: previous session's socket closes (grace),
  new session connects.
- Same session opened in a second cell/tab: `superseded` handled, no reconnect
  ping-pong.
- Command/Run terminal: unchanged — ephemeral, no reconnect.

## Risks / notes

- **Client memory**: N persisted xterm instances + sockets. Bounded by scrollback
  per terminal; fine for realistic open-tab counts. Re-evaluate if users keep
  very many cells open.
- **xterm re-parenting**: moving the `host` element between containers is the
  load-bearing trick; confirm `fit()` + `scrollToBottom()` behave on re-attach
  (the existing ResizeObserver already calls these).
- **Dirty disappearance** (out of scope, see Non-goals): unchanged in mechanism,
  wider in scope. Optional future WS ping/pong sweep would tighten the ~2h
  zombie window — tracked separately.
