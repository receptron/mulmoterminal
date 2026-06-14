<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

// `null` => start a fresh session; otherwise resume the given session id.
// `connectKey` increments on every user action so re-selecting the same
// session (or starting another fresh one) still forces a reconnect.
const props = defineProps<{ sessionId: string | null; connectKey: number }>();

const terminalRef = ref<HTMLDivElement>();
const status = ref<"connecting" | "connected" | "disconnected">("connecting");

let term: Terminal;
let fitAddon: FitAddon;
let ws: WebSocket | null = null;
let resizeObserver: ResizeObserver;
let reconnecting = false;

function connect() {
  // Tear down any existing connection without flipping status to disconnected.
  if (ws) {
    reconnecting = true;
    ws.close();
    ws = null;
  }
  term.reset();
  status.value = "connecting";

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const query = props.sessionId ? `?session=${encodeURIComponent(props.sessionId)}` : "";
  const sock = new WebSocket(`${proto}//${location.host}/ws${query}`);
  ws = sock;

  sock.onopen = () => {
    status.value = "connected";
    sock.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };

  sock.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "output") {
      term.write(msg.data);
    } else if (msg.type === "exit") {
      term.write("\r\n\x1b[33m[session ended]\x1b[0m\r\n");
      status.value = "disconnected";
    }
  };

  sock.onclose = () => {
    // Ignore the close triggered by an intentional reconnect.
    if (reconnecting && sock !== ws) {
      reconnecting = false;
      return;
    }
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

  term.open(terminalRef.value!);
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
  resizeObserver.observe(terminalRef.value!);

  connect();
  term.focus();
});

// Reconnect (resume a different session / start fresh) on every user action.
watch(
  () => props.connectKey,
  () => {
    connect();
    term.focus();
  }
);

onUnmounted(() => {
  resizeObserver?.disconnect();
  ws?.close();
  term?.dispose();
});
</script>

<template>
  <div class="terminal-wrapper">
    <div class="header">
      <span class="title">mulmoterminal</span>
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
  height: 100vh;
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
