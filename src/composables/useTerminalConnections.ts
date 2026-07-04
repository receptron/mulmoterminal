// A module-singleton manager that owns each terminal's durable runtime — its
// WebSocket, xterm instance, reconnect/backoff state — independent of the Vue
// component lifecycle. This is what lets a session's PTY stay alive (and its
// socket stay open) while its Terminal.vue is unmounted: navigating away, flipping
// to an off-page grid tab, or toggling Grid<->single only DETACHES the view (the
// xterm's host element is re-parented out of the DOM), it does not close the socket.
//
// Why this matters: the server keeps a PTY alive for exactly as long as its
// WebSocket is open (it only arms the reap grace timer on socket close). So holding
// the socket open here means coming back reattaches an already-live session — no
// `claude --resume`, no "restoring session" token cost — instead of a cold resume.
//
// Each terminal "slot" is addressed by a stable key: the grid cell's uid
// (`cell-<uid>`), the single view's `single`, or an ephemeral id for command/Run
// terminals (which are NOT persisted — their process is unresumable, so their slot
// is released on unmount like before).
import { reactive } from "vue";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { ClipboardAddon, type IClipboardProvider } from "@xterm/addon-clipboard";
import "@xterm/xterm/css/xterm.css";
import { buildTerminalWsUrl, buildRunWsUrl, buildLaunchWsUrl } from "../components/wsUrl";

export type ConnStatus = "connecting" | "connected" | "disconnected";

// What a slot connects to. Mirrors the relevant Terminal.vue props; a connectKey
// change (session switch / relaunch) hands a fresh target to retarget().
export interface ConnTarget {
  sessionId: string | null;
  cwd: string | null;
  devTerminal: boolean;
  command: { index: number } | null;
  // A configured launcher (shell/codex/command). Unlike `command` this is a PERSISTENT
  // session — it reconnects on drop and reattaches by session id, like a Claude cell.
  launcher: { index: number } | null;
}

// Forwarded to whatever component is currently attached, so the parent's existing
// session/cwd/exit wiring (grid_v2 persistence, recent-dir recording, re-run UI)
// keeps working unchanged. Cleared on detach; a detached slot still tracks its
// knownSessionId internally for a later reattach.
export interface ConnHandlers {
  onSession?: (id: string) => void;
  onCwd?: (cwd: string) => void;
  onExit?: () => void;
}

interface Conn {
  key: string;
  term: Terminal;
  fitAddon: FitAddon;
  host: HTMLDivElement; // term.open()'d into this ONCE; re-parented on attach/detach
  ws: WebSocket | null;
  knownSessionId: string | null;
  knownCwd: string | null; // server-resolved cwd, replayed on (re)attach
  target: ConnTarget;
  handlers: ConnHandlers;
  sawExit: boolean; // an intentional end (exit/superseded/error) — suppress reconnect
  released: boolean; // torn down — suppress reconnect and stray socket events
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  attachedEl: HTMLElement | null;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

// The heavy per-slot runtime (non-reactive — Vue never needs to track these).
const conns = new Map<string, Conn>();

// The reactive projection the view binds to (status pill, RunMenu cwd). Keyed by
// the same slot key; a slot that hasn't connected yet (or was released) is absent.
export const connView = reactive(new Map<string, { status: ConnStatus; serverCwd: string | null }>());

function setStatus(c: Conn, s: ConnStatus) {
  const v = connView.get(c.key);
  if (v) v.status = s;
}

// Claude Code emits OSC 52 with an EMPTY selection (`ESC ] 52 ; ; <base64>`), which
// the addon's default provider silently drops (it only writes for selection "c").
// Route the empty (and "c") selection to the system clipboard so the auto-copy lands.
export const isSystemClipboard = (selection: string): boolean => selection === "" || selection === "c";
const clipboardProvider: IClipboardProvider = {
  // OSC 52 clipboard READ is disabled: letting a terminal program read the user's
  // clipboard (`ESC ] 52 ; <sel> ; ?`) is an exfiltration vector, and nothing here
  // needs it (paste uses the browser's native Cmd+V). This is write-only.
  readText() {
    return "";
  },
  async writeText(selection, text) {
    if (!isSystemClipboard(selection)) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard blocked (no focus / permission) — best effort
    }
  },
};

function ensure(key: string, target: ConnTarget): Conn {
  const existing = conns.get(key);
  if (existing) {
    existing.target = target;
    return existing;
  }
  const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  // OSC 52 clipboard: Claude Code auto-copies the selection via OSC 52 — without this
  // addon xterm ignores it, so the copy silently never reaches the browser clipboard.
  term.loadAddon(new ClipboardAddon(undefined, clipboardProvider));
  const host = document.createElement("div");
  host.style.width = "100%";
  host.style.height = "100%";
  term.open(host);

  const c: Conn = {
    key,
    term,
    fitAddon,
    host,
    ws: null,
    knownSessionId: target.sessionId,
    knownCwd: null,
    target,
    handlers: {},
    sawExit: false,
    released: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    attachedEl: null,
  };
  conns.set(key, c);
  connView.set(key, { status: "connecting", serverCwd: target.cwd });

  // Terminal input -> the slot's CURRENT socket (survives reconnects: `c.ws` is
  // re-read each keystroke, so input always targets the live socket).
  term.onData((data) => {
    if (c.ws && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify({ type: "input", data }));
    }
  });
  return c;
}

function scheduleReconnect(c: Conn) {
  // A command/Run process is unique and unresumable — never reconnect it. A
  // released or intentionally-ended slot stays down too.
  if (c.released || c.sawExit || c.reconnectTimer || c.target.command) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** c.reconnectAttempts, RECONNECT_MAX_MS);
  c.reconnectAttempts++;
  c.reconnectTimer = setTimeout(() => {
    c.reconnectTimer = null;
    if (!c.released) connect(c);
  }, delay);
}

// Pick the endpoint for a target: a Run command (ephemeral), a launcher (persistent
// shell/codex), or a Claude session (default). Kept flat to avoid a nested ternary.
function connUrl(target: ConnTarget, resumeId: string | null, secure: boolean): string {
  const host = location.host;
  if (target.command) return buildRunWsUrl({ host, secure, index: target.command.index, cwd: target.cwd });
  if (target.launcher) return buildLaunchWsUrl({ host, secure, sessionId: resumeId, cwd: target.cwd, launcher: target.launcher.index });
  return buildTerminalWsUrl({ host, secure, sessionId: resumeId, cwd: target.cwd, devTerminal: target.devTerminal });
}

function connect(c: Conn) {
  if (c.released) return;
  if (c.reconnectTimer) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  // Neutralise the old socket's late events via the `sock !== c.ws` guards below.
  if (c.ws) c.ws.close();
  c.term.reset();
  c.sawExit = false;
  setStatus(c, "connecting");
  // Drop the previous session's resolved cwd so the Run menu can't list/launch the
  // prior project's scripts before the new `session` message arrives.
  const v = connView.get(c.key);
  if (v) v.serverCwd = c.target.cwd;

  // Resume the known id (server-learned, or the prop) so a reconnect re-attaches the
  // same session instead of spawning a fresh one each retry.
  const resumeId = c.knownSessionId ?? c.target.sessionId;
  const secure = location.protocol === "https:";
  const url = connUrl(c.target, resumeId, secure);
  const sock = new WebSocket(url);
  c.ws = sock;

  sock.onopen = () => {
    if (sock !== c.ws) return;
    c.reconnectAttempts = 0;
    setStatus(c, "connected");
    sock.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  };
  sock.onmessage = (event) => {
    if (sock !== c.ws) return;
    handleMessage(c, event);
  };
  sock.onclose = () => {
    if (sock !== c.ws) return;
    setStatus(c, "disconnected");
    scheduleReconnect(c);
  };
  sock.onerror = () => {
    if (sock !== c.ws) return;
    setStatus(c, "disconnected");
  };
}

function handleMessage(c: Conn, event: MessageEvent) {
  const msg = JSON.parse(event.data);
  if (msg.type === "output") {
    c.term.write(msg.data);
  } else if (msg.type === "session") {
    // Server reports the live session id — remember it so a later reconnect resumes
    // THIS session (esp. brand-new sessions that had no id yet) and the effective cwd.
    c.knownSessionId = msg.id;
    c.handlers.onSession?.(msg.id);
    if (typeof msg.cwd === "string") {
      c.knownCwd = msg.cwd;
      const v = connView.get(c.key);
      if (v) v.serverCwd = msg.cwd;
      c.handlers.onCwd?.(msg.cwd);
    }
  } else if (msg.type === "exit") {
    // The process exited (claude, or a Run command) — an intentional end; don't
    // auto-reconnect. The cell uses `exit` to offer a re-run.
    c.sawExit = true;
    c.term.write(c.target.command ? "\r\n\x1b[33m[finished]\x1b[0m\r\n" : "\r\n\x1b[33m[session ended]\x1b[0m\r\n");
    setStatus(c, "disconnected");
    c.handlers.onExit?.();
  } else if (msg.type === "superseded") {
    // Another client (this session open in another tab/cell) took over. Stop —
    // reconnecting would kick the other one off and ping-pong forever.
    c.sawExit = true;
    c.term.write("\r\n\x1b[33m[detached — this session is open in another window]\x1b[0m\r\n");
    setStatus(c, "disconnected");
  } else if (msg.type === "error") {
    // Server-declared terminal failure (CLI missing, command unresolvable). Not
    // transient — reconnecting would re-trigger the failed spawn, so stop and
    // surface a stable error. Emit `exit` so a CommandCell can offer a re-run.
    c.sawExit = true;
    const detail = typeof msg.message === "string" ? msg.message : "failed to start";
    c.term.write(`\r\n\x1b[31m[${detail}]\x1b[0m\r\n`);
    setStatus(c, "disconnected");
    c.handlers.onExit?.();
  }
}

// Mount a view onto a slot: create the runtime on first acquire (and connect),
// otherwise reattach the persisted xterm to the new DOM host. Never reconnects an
// already-live slot — that's the whole point (no cold resume on remount).
export function attach(key: string, target: ConnTarget, handlers: ConnHandlers, el: HTMLElement, theme?: ITheme) {
  const created = !conns.has(key);
  const c = ensure(key, target);
  c.released = false;
  c.handlers = handlers;
  c.attachedEl = el;
  // Replay server-learned session/cwd to the freshly-bound handlers. Without this,
  // a slot that learned its id/cwd WHILE DETACHED (handlers were cleared) would
  // never forward them, leaving the parent persisted as `session: null` and the
  // session unrestorable on reload. Only the new-vs-known case actually fires a
  // useful update; the parent's setters are idempotent for already-known values.
  if (c.knownSessionId) handlers.onSession?.(c.knownSessionId);
  if (c.knownCwd) handlers.onCwd?.(c.knownCwd);
  el.appendChild(c.host);
  if (theme) c.term.options.theme = theme;
  if (created) connect(c);
  // Fit to the (now on-screen) host, sync the PTY size, and stick to the bottom.
  try {
    c.fitAddon.fit();
  } catch {
    // host not laid out yet — the ResizeObserver fit() will follow
  }
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  c.term.scrollToBottom();
  c.term.focus();
}

// Unmount a view but KEEP the slot alive (socket stays open, PTY stays alive). The
// xterm's host is re-parented out of the DOM; the buffer/scrollback are preserved.
export function detach(key: string, el: HTMLElement | null) {
  const c = conns.get(key);
  if (!c) return;
  if (el && c.attachedEl !== el) return; // a newer attach already took over this slot
  c.handlers = {};
  if (c.host.parentElement) c.host.remove();
  c.attachedEl = null;
}

// connectKey changed (session switch / relaunch in the same slot): point the slot
// at the new target and reconnect. Closes the previous socket, so the previous
// session falls back to the server's reap grace.
export function retarget(key: string, target: ConnTarget) {
  const c = conns.get(key);
  if (!c) return;
  c.target = target;
  c.knownSessionId = target.sessionId;
  c.knownCwd = null;
  c.reconnectAttempts = 0;
  c.sawExit = false;
  c.released = false;
  connect(c);
}

// Permanently tear the slot down (close socket, dispose xterm). Used for ephemeral
// (command) slots on unmount, and as the back end of terminate().
export function release(key: string) {
  const c = conns.get(key);
  if (!c) return;
  c.released = true;
  if (c.reconnectTimer) {
    clearTimeout(c.reconnectTimer);
    c.reconnectTimer = null;
  }
  try {
    c.ws?.close();
  } catch {
    // already closing
  }
  c.ws = null;
  try {
    c.host.remove();
  } catch {
    // not in the DOM
  }
  try {
    c.term.dispose();
  } catch {
    // already disposed
  }
  conns.delete(key);
  connView.delete(key);
}

// Explicit close (the cell's ✕): tell the server to reap this session NOW instead
// of holding it through the disconnect grace window, then tear the slot down.
export function terminate(key: string) {
  const c = conns.get(key);
  if (!c) return;
  c.sawExit = true;
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "terminate" }));
  release(key);
}

// Submit a GUI-originated message into the PTY (text + a SEPARATE delayed CR — a
// same-burst text+CR reads as a paste in Claude's TUI). Both writes pin to the
// socket captured now; if the slot reconnects before the CR fires we skip it rather
// than submit a stray turn. Returns whether the text was delivered.
export function submitText(key: string, text: string): boolean {
  const c = conns.get(key);
  if (!c) return false;
  const sock = c.ws;
  if (!sock || sock.readyState !== WebSocket.OPEN) return false;
  sock.send(JSON.stringify({ type: "input", data: text }));
  setTimeout(() => {
    if (c.ws === sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "input", data: "\r" }));
    }
  }, 60);
  return true;
}

// Insert text (a path, or space-joined paths) at the cursor via the normal input
// channel — no trailing CR, so the user reviews and submits.
export function insertText(key: string, text: string) {
  if (!text) return;
  const c = conns.get(key);
  if (!c) return;
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "input", data: text }));
  c.term.focus();
}

export function focus(key: string) {
  conns.get(key)?.term.focus();
}

// Refit to the current host size and push the new dimensions to the PTY.
export function fit(key: string) {
  const c = conns.get(key);
  if (!c || !c.attachedEl) return;
  try {
    c.fitAddon.fit();
  } catch {
    // host has no size yet
  }
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  // Reflow after a resize can leave the viewport scrolled up; stick to the bottom.
  c.term.scrollToBottom();
}

export function setTheme(key: string, theme: ITheme) {
  const c = conns.get(key);
  if (c) c.term.options.theme = theme;
}
