# A session opened beside the Files pane runs at the split width (#2986)

## Reproduced

On the real app (this checkout's build served on an isolated HOME, a stub `claude`, Playwright):
a claude cell enlarged, the Files pane opened and widened so the terminal beside it is narrow,
then a new claude cell from the enlarged cell's `+`. Logging every WebSocket frame the browser
sends and polling `tmux list-clients` / `list-windows` on the sandbox's own socket:

- the new cell connects with the split width on its URL — it is measured while the previous
  cell's pane is still mounted (the pane leaves only after its buffer flush);
- on the socket's `open` the browser sends a `resize` with the full width;
- the pty is spawned at the URL's size and tmux's client and window stay there; nothing arrives
  to move them, for as long as the run watched.

The same with and without unsaved edits in the pane's editor.

## Cause

Every agent handler attached the early-frame buffer in `announceSession`, which runs after the
admission's awaits — hydration, session resolution, the per-session lock, the worktree
reservation, the tmux survivor probe, the worktree occupancy read. The browser's first frames
(`resize`, then `view`) land in that window, on a socket with no `message` listener, and the
`ws` library drops them. `applyClientSize` then puts the URL's stale size on the pty and nothing
re-sends the real one until the host's size changes again. `early-frames.ts` was written for
exactly this window (#1178), but was attached too late to cover it; the comment at the claude
call site claimed it covered the Keychain await, which it followed rather than preceded.

The `/ws/run` endpoint had the same window between the accept and `ws.on("message")`, behind a
git-backed resolve.

## Fix

`acceptTerminalConnection(ws, req)` (`server/routes/ws-accept.ts`) reads the request AND attaches the
buffer in one step, and is the first thing every connection handler does, before its first await —
so no handler can take the request without the buffer. It is handed down to `admitAgentSession` (and through
`admitInSessionDir`), which discards it on a refusal; `announceSession` now only sends the
`session` frame. `beginRunTerminal` takes the buffer as well and replays it after the real
listener is installed, in the order `startAndWire` keeps.

Not changed: measuring a new cell beside a pane that is on its way out. With the correction
applied, the pty is resized before the program inside draws anything, so the stale URL size costs
nothing visible; closing that window in the grid is a separate change if it is wanted.

## Verified

- `test/server/routes/ws-early-frames-from-accept.spec.ts` drives the copilot handler with a frame
  emitted synchronously after the call — the handler parked at its first await, where a real
  browser's first frame lands — and asserts it reaches the pty's frame handler; a second case
  reads the route file and checks each handler calls it before its first await. The first
  case is red on the previous code.
- `test/server/routes/ws-run-terminal.spec.ts` gains the replay case for the command endpoint.
- The same real-app run as above after the fix: tmux's client and window for the new session
  follow the browser's `open` resize within the first poll, with and without unsaved edits.
