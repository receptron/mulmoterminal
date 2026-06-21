<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { buildTerminalWsUrl } from "./wsUrl";
import { dropTextFromUriList, toInsertText } from "./dropPaths";
import { useTheme, currentTermTheme } from "../composables/useTheme";

// `null` => start a fresh session; otherwise resume the given session id.
// `connectKey` increments on every user action so re-selecting the same
// session (or starting another fresh one) still forces a reconnect.
// `devTerminal` runs claude as a plain dev terminal (the grid): NO GUI plugin MCP
// and NO --strict-mcp-config, so the user's (~/.claude.json) + project's (.mcp.json)
// MCP servers load normally. Default (false, the single view) keeps main's behavior:
// the in-process GUI MCP attached and isolated with --strict-mcp-config.
const props = defineProps<{ sessionId: string | null; connectKey: number; cwd?: string | null; devTerminal?: boolean }>();
const emit = defineEmits<{ (e: "session" | "cwd", value: string): void }>();

const terminalRef = ref<HTMLDivElement>();
const status = ref<"connecting" | "connected" | "disconnected">("connecting");
const dragOver = ref(false);
const { themeId } = useTheme();

let term: Terminal;
let fitAddon: FitAddon;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver;

// Auto-reconnect state. A dropped/failed socket retries with backoff, resuming
// the KNOWN session id (so we never spawn a duplicate new session per retry).
// Reconnect is suppressed after an intentional end: the server's `exit` message
// (claude exited) or the component unmounting.
let knownSessionId: string | null = props.sessionId;
let sawExit = false;
let disposed = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 5000;

function scheduleReconnect() {
  if (disposed || sawExit || reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!disposed) connect();
  }, delay);
}

function connect() {
  // Tear down any existing connection. Its handlers are neutralised below by the
  // `sock !== ws` guards once `ws` is reassigned, so a late event from the old
  // socket can't flip the status or leak output into the new session.
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) ws.close();
  term.reset();
  sawExit = false;
  status.value = "connecting";

  // Resume the known id (learned from the server, or the prop) so a reconnect
  // re-attaches the same session instead of spawning a fresh one each retry.
  const resumeId = knownSessionId ?? props.sessionId;
  const sock = new WebSocket(
    buildTerminalWsUrl({
      host: location.host,
      secure: location.protocol === "https:",
      sessionId: resumeId,
      cwd: props.cwd,
      devTerminal: props.devTerminal,
    }),
  );
  ws = sock;

  sock.onopen = () => {
    if (sock !== ws) return;
    reconnectAttempts = 0;
    status.value = "connected";
    sock.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };

  sock.onmessage = (event) => {
    if (sock !== ws) return;
    const msg = JSON.parse(event.data);
    if (msg.type === "output") {
      term.write(msg.data);
    } else if (msg.type === "session") {
      // Server reports the live session id — remember it so a later reconnect
      // resumes THIS session (esp. for brand-new sessions that had no id yet) —
      // and the EFFECTIVE cwd, which the cell adopts (the server may have fallen
      // back from the requested dir).
      knownSessionId = msg.id;
      emit("session", msg.id);
      if (typeof msg.cwd === "string") emit("cwd", msg.cwd);
    } else if (msg.type === "exit") {
      // claude itself exited — an intentional end; don't auto-reconnect.
      sawExit = true;
      term.write("\r\n\x1b[33m[session ended]\x1b[0m\r\n");
      status.value = "disconnected";
    } else if (msg.type === "superseded") {
      // Another client (e.g. this session open in another tab/window) took over.
      // Stop — reconnecting would kick the other one off and ping-pong forever.
      sawExit = true;
      term.write("\r\n\x1b[33m[detached — this session is open in another window]\x1b[0m\r\n");
      status.value = "disconnected";
    } else if (msg.type === "error") {
      // Server-declared terminal failure (e.g. the `claude` CLI isn't installed).
      // Not transient — reconnecting would just re-trigger the failed spawn, so
      // stop and surface a stable error instead of looping.
      sawExit = true;
      const detail = typeof msg.message === "string" ? msg.message : "failed to start";
      term.write(`\r\n\x1b[31m[${detail}]\x1b[0m\r\n`);
      status.value = "disconnected";
    }
  };

  sock.onclose = () => {
    // A newer socket has superseded this one — ignore its close.
    if (sock !== ws) return;
    status.value = "disconnected";
    // Unexpected drop (server restart, transient network) — retry with backoff.
    scheduleReconnect();
  };

  sock.onerror = () => {
    if (sock !== ws) return;
    // onclose fires after onerror and drives the reconnect; nothing to do here
    // beyond surfacing the state.
    status.value = "disconnected";
  };
}

onMounted(() => {
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
    theme: currentTermTheme(),
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());

  const container = terminalRef.value;
  if (!container) return;
  term.open(container);
  fitAddon.fit();

  // Terminal input -> server
  term.onData((data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  });

  // Auto-resize
  resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
    }
    // Reflow after a resize (e.g. restoring a cell from zoom) can leave the
    // viewport scrolled up; stick to the bottom so the prompt stays in view.
    term.scrollToBottom();
  });
  resizeObserver.observe(container);

  connect();
  term.focus();
});

// Reconnect (resume a different session / start fresh) on every user action.
// A user action picks a new target, so reset the reconnect bookkeeping and adopt
// the new selection as the session to (re)connect to.
watch(
  () => props.connectKey,
  () => {
    knownSessionId = props.sessionId;
    reconnectAttempts = 0;
    connect();
    term.focus();
  },
);

// xterm can't read CSS variables, so repaint its canvas palette when the theme
// changes (keeps an already-open terminal in sync with the rest of the app).
watch(themeId, () => {
  if (term) term.options.theme = currentTermTheme();
});

// Submit a GUI-originated message into the PTY (same channel as keyboard input).
// This is the GUI->LLM feedback path. We type the text, then send a SEPARATE
// delayed carriage return — a same-burst text+CR is treated as a paste by Claude
// Code's TUI, so the CR becomes a newline instead of submitting.
//
// Both writes are pinned to the socket captured *now*: if the session switches or
// reconnects before the CR fires, that socket is no longer `ws`, so we skip the CR
// rather than submit a stray turn in whatever session is current. Returns whether
// the text was delivered, so the caller (e.g. a form) only locks on success.
function submitText(text: string): boolean {
  const sock = ws;
  if (!sock || sock.readyState !== WebSocket.OPEN) return false;
  sock.send(JSON.stringify({ type: "input", data: text }));
  setTimeout(() => {
    if (sock === ws && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify({ type: "input", data: "\r" }));
    }
  }, 60);
  return true;
}
// Explicit close (the cell's ✕): tell the server to reap this session now
// instead of holding it through the disconnect grace window. Suppress reconnect
// since the imminent unmount closes the socket.
function terminate() {
  sawExit = true;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "terminate" }));
}
defineExpose({ submitText, terminate });

// Insert text (a path, or space-joined paths) at the terminal cursor via the
// normal input channel — no trailing CR, so the user reviews and submits.
function insertText(text: string) {
  if (!text) return;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data: text }));
  term.focus();
}

// Drop a file onto the terminal to insert its absolute path, like a native
// terminal. Browsers expose the real path only via the drag's file:// URIs
// (text/uri-list); the File object hides it. Browsers that withhold the path
// (e.g. Chrome) yield no URIs, so we insert nothing rather than a wrong string —
// the file-picker button is the path-in-Chrome route.
function onDrop(e: DragEvent) {
  dragOver.value = false;
  const dt = e.dataTransfer;
  if (!dt || dt.files.length === 0) return; // not a file drop — leave text drags alone
  e.preventDefault();
  insertText(dropTextFromUriList(dt.getData("text/uri-list") || dt.getData("text/plain")));
}

function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault(); // required for the drop event to fire
  dragOver.value = true;
}

// The file-icon button: the browser can't reveal a real path, so the local
// server opens the OS file dialog and returns the chosen absolute path(s). Works
// in every browser (the cross-browser path route, unlike file:// drag/drop).
async function pickFile() {
  try {
    const res = await fetch("/api/pick-file", { method: "POST", headers: { "content-type": "application/json" } });
    if (!res.ok) return;
    const data: unknown = await res.json();
    const paths = isRecord(data) && Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === "string") : [];
    insertText(toInsertText(paths));
  } catch {
    // best-effort — the native dialog is unavailable or the user canceled
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

onUnmounted(() => {
  disposed = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  resizeObserver?.disconnect();
  ws?.close();
  term?.dispose();
});
</script>

<template>
  <div class="terminal-wrapper">
    <div class="header">
      <span class="title">Terminal</span>
      <span :class="['status', status]">{{ status }}</span>
      <button type="button" class="pick-file" title="Insert a file path" aria-label="Insert a file path" @click="pickFile">
        <span class="material-symbols-outlined">attach_file</span>
      </button>
    </div>
    <div ref="terminalRef" :class="['terminal-container', { 'drag-over': dragOver }]" @dragover="onDragOver" @dragleave="dragOver = false" @drop="onDrop" />
  </div>
</template>

<style scoped>
.terminal-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: var(--bg-base);
}

.header {
  padding: 8px 16px;
  background: var(--bg-panel);
  color: var(--text);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-weight: 600;
}

.pick-file {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  padding: 2px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
}

.pick-file:hover {
  background: var(--bg-selected);
  color: var(--text);
}

.pick-file .material-symbols-outlined {
  font-size: 18px;
}

.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}

.status.connected {
  background: var(--ok-bg);
  color: var(--ok);
}

.status.connecting {
  background: var(--warn-bg);
  color: var(--warn);
}

.status.disconnected {
  background: var(--err-deep);
  color: var(--err);
}

/* min-height:0 is load-bearing: a flex item's default min-height is `auto`
   (its content's min size), which pins this xterm host to the terminal's full
   rendered height. In a short grid cell that overflows and is clipped — the
   bottom input row can't be seen or scrolled to — and FitAddon then reads the
   un-shrunk height and never reduces the rows. min-height:0 lets it shrink so
   fit() can size the terminal to the cell. */
.terminal-container {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

.terminal-container.drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}
</style>
