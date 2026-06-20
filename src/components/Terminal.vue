<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { buildTerminalWsUrl } from "./wsUrl";

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
    theme: {
      background: "#1a1a2e",
      foreground: "#e0e0e0",
      cursor: "#e0e0e0",
      selectionBackground: "#3a3a5e",
    },
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
    </div>
    <div ref="terminalRef" class="terminal-container" />
  </div>
</template>

<style scoped>
.terminal-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: #1a1a2e;
}

.header {
  padding: 8px 16px;
  background: #16213e;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.title {
  font-weight: 600;
}

.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
}

.status.connected {
  background: #1b5e20;
  color: #a5d6a7;
}

.status.connecting {
  background: #e65100;
  color: #ffcc80;
}

.status.disconnected {
  background: #b71c1c;
  color: #ef9a9a;
}

.terminal-container {
  flex: 1;
  padding: 4px;
}
</style>
