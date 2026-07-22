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
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { connWsUrl, type LaunchChoice } from "../components/wsUrl";
import { reconnectDelayMs, shouldReconnect } from "./reconnectPolicy";
import type { RunCommand } from "../components/runCommand";
import { readableSlot, type SlotCandidate, type SlotInfo } from "./readableSlot";

export type ConnStatus = "connecting" | "connected" | "disconnected";

// Shift+Enter must insert a NEWLINE in the prompt, not submit. xterm sends "\r" for
// both Enter and Shift+Enter, so the PTY can't tell them apart — we intercept the key
// and send the sequence Claude Code reads as a newline (Meta/Alt+Enter = ESC + CR).
export const NEWLINE_SEQUENCE = "\x1b\r";
type ModifierKeyEvent = Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey">;
export function shiftEnterNewline(e: ModifierKeyEvent): string | null {
  const isShiftEnter = e.type === "keydown" && e.key === "Enter" && e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
  return isShiftEnter ? NEWLINE_SEQUENCE : null;
}

// The xterm custom key handler: on Shift+Enter, `send` the newline and return false (cancel xterm's
// default \r); otherwise return true so xterm handles the key normally. `preventDefault()` is essential:
// xterm's _keyDown returns early on a false custom handler WITHOUT preventDefault, so the browser fires a
// follow-up keypress that _keyPress turns into a bare \r — submitting the prompt. Cancelling the default
// stops that keypress.
type ShiftEnterEvent = ModifierKeyEvent & { preventDefault: () => void };
export function makeShiftEnterHandler(send: (data: string) => void): (e: ShiftEnterEvent) => boolean {
  return (e) => {
    const newline = shiftEnterNewline(e);
    if (newline === null) return true;
    e.preventDefault();
    send(newline);
    return false;
  };
}

// What a slot connects to. Mirrors the relevant Terminal.vue props; a connectKey
// change (session switch / relaunch) hands a fresh target to retarget().
export interface ConnTarget {
  sessionId: string | null;
  cwd: string | null;
  devTerminal: boolean;
  command: RunCommand | null;
  // A configured launcher (shell/codex/command) by index, or the OS default shell
  // (`{ shell: true }`, the header "new terminal" button). Unlike `command` this is a
  // PERSISTENT session — it reconnects on drop and reattaches by session id, like a Claude cell.
  launcher: { index: number } | { shell: true } | null;
  // A first-class codex session (/ws/codex) instead of a Claude one. Persistent &
  // reattachable like a Claude cell; the server discovers + resumes codex's own id.
  codex?: boolean;
  // The provider/model the launch form picked for this session (#584). Claude only —
  // it rides the /ws query and overrides the directory's default.
  launch?: LaunchChoice | null;
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

// The heavy per-slot runtime (non-reactive — Vue never needs to track these).
const conns = new Map<string, Conn>();

// Fit the terminal to its host, push the new size to the PTY, and stick to the
// bottom. The fit() can throw when the host isn't laid out yet — the caller's
// ResizeObserver fit() then follows — so it's swallowed.
function fitAndSyncSize(c: Conn): void {
  try {
    c.fitAddon.fit();
  } catch {
    // host not laid out yet
  }
  if (c.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "resize", cols: c.term.cols, rows: c.term.rows }));
  c.term.scrollToBottom();
}

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
    // Treat macOS Option as Meta so Claude's Alt bindings reach the PTY — Alt+Enter
    // (newline), Alt+B/F (word nav), Alt+Backspace (delete word). The cost is Option
    // dead-key accent entry (é etc.), which a coding terminal doesn't need.
    macOptionIsMeta: true,
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
  // Render each glyph in its own cell (canvas) instead of the default DOM renderer, which flows text
  // as inline runs. A full-width CJK glyph that isn't exactly 2× the Latin cell would otherwise let a
  // long Japanese line drift right and spill its tail past the terminal's edge into the hidden area.
  // Best-effort: if the canvas renderer can't initialise, xterm keeps the DOM renderer.
  try {
    term.loadAddon(new CanvasAddon());
  } catch (err) {
    console.warn("[terminal] canvas renderer unavailable — falling back to the DOM renderer", err);
  }

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
  // Shift+Enter → newline (not submit): send the sequence ourselves and suppress the
  // \r xterm would otherwise emit for it (returning false cancels the default).
  term.attachCustomKeyEventHandler(
    makeShiftEnterHandler((data) => {
      if (c.ws && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "input", data }));
    }),
  );
  return c;
}

function scheduleReconnect(c: Conn) {
  if (!shouldReconnect({ released: c.released, sawExit: c.sawExit, reconnectPending: c.reconnectTimer !== null, isCommand: !!c.target.command })) return;
  const delay = reconnectDelayMs(c.reconnectAttempts);
  c.reconnectAttempts++;
  c.reconnectTimer = setTimeout(() => {
    c.reconnectTimer = null;
    if (!c.released) connect(c);
  }, delay);
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
  const url = connWsUrl(c.target, resumeId, location.host, secure);
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
  fitAndSyncSize(c);
  c.term.focus();
  // The persisted xterm was just re-parented into a new host. The sync fit() above can no-op (same size)
  // or run before layout, leaving the canvas renderer blank until a scroll. Re-fit + force a repaint next
  // frame, once the host is laid out. Guarded so a slot that detached/re-attached meanwhile is left alone.
  requestAnimationFrame(() => {
    if (c.attachedEl === el) fit(key);
  });
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

// Insert a MULTI-LINE block at the cursor, wrapped as a bracketed paste. Without the
// wrapper each newline in the block reads as Enter and the agent submits a fragment per
// line; inside it, the TUI takes the whole thing as one edit. No trailing CR — the user
// reads what arrived and sends it themselves. The text must already be free of control
// bytes (the server sanitizes it), or it could close the paste early.
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
export function pasteText(key: string, text: string): boolean {
  const c = conns.get(key);
  if (!text || c?.ws?.readyState !== WebSocket.OPEN) return false;
  c.ws.send(JSON.stringify({ type: "input", data: `${PASTE_START}${text}${PASTE_END}` }));
  c.term.focus();
  return true;
}

// The slots whose conversation another cell can read. A snapshot, not a reactive view:
// the caller is a menu that opens, gets picked from, and closes. What counts as
// readable lives in readableSlot — this only flattens each Conn for it to judge.
const slotCandidate = (c: Conn): SlotCandidate => ({
  key: c.key,
  connected: c.ws?.readyState === WebSocket.OPEN,
  isCommand: c.target.command !== null,
  isShellLauncher: !!c.target.launcher && "shell" in c.target.launcher,
  sessionId: c.knownSessionId,
  cwd: c.knownCwd ?? c.target.cwd,
  codex: !!c.target.codex,
});

export function listSlots(): SlotInfo[] {
  return [...conns.values()].map(slotCandidate).flatMap((candidate) => readableSlot(candidate) ?? []);
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

// Tell the server whether this slot is the user's actively-viewed pane (a grid cell
// zoomed to fill, vs. one tile among many). An active pane suppresses its attention
// flag and marks it read; an inactive grid cell can surface blocked/done while
// unfocused. No-op if the socket isn't open — Terminal.vue re-sends on (re)connect.
export function sendView(key: string, active: boolean) {
  const c = conns.get(key);
  if (c?.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "view", active }));
}

// Read a slot's xterm buffer (scrollback + viewport) as plain text — used to hand a
// command cell's captured output to the AI summariser. Each line is trailing-trimmed
// by translateToString; trailing blank lines are dropped. "" for an unknown slot.
export function readBuffer(key: string): string {
  const c = conns.get(key);
  if (!c) return "";
  const buf = c.term.buffer.active;
  const lines = Array.from({ length: buf.length }, (_, i) => buf.getLine(i)?.translateToString(true) ?? "");
  return lines.join("\n").trimEnd();
}

// Refit to the current host size and push the new dimensions to the PTY.
export function fit(key: string) {
  const c = conns.get(key);
  if (!c || !c.attachedEl) return;
  fitAndSyncSize(c);
  // Force the canvas renderer to repaint. `fit()` only redraws when cols/rows actually change, so a
  // re-parent / KeepAlive reactivation with the SAME size (attach, onActivated) would otherwise leave
  // the viewport blank until a scroll. The buffer is intact — this just repaints it.
  if (c.term.rows > 0) c.term.refresh(0, c.term.rows - 1);
}

export function setTheme(key: string, theme: ITheme) {
  const c = conns.get(key);
  if (c) c.term.options.theme = theme;
}
