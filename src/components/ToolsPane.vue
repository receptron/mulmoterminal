<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { usePubSub } from "../composables/usePubSub";

// The tools pane mirrors MulmoClaude's right sidebar: an "Available Tools" list
// (the GUI plugin tools, with collapsible descriptions) and a "Tool Call History"
// for the active session. The history is fed by Claude's PreToolUse/PostToolUse
// hooks, so it shows EVERY tool call — built-ins (Bash, Read, …), other MCP tools,
// and our GUI plugin tools — not just the GUI ones. Live updates arrive on the
// toolcalls:<id> channel; history replays from /api/tool-calls/:id on (re)select.
interface AvailableTool {
  toolName: string;
  title?: string;
  description?: string;
}
interface ToolCall {
  toolUseId?: string;
  toolName: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  status: "running" | "completed" | "failed";
  at: number;
  durationMs?: number;
}

const props = defineProps<{ sessionId: string | null }>();

const availableTools = ref<AvailableTool[]>([]);
const toolCalls = ref<ToolCall[]>([]);
const expandedTools = ref<Set<string>>(new Set());
const expandedCalls = ref<Set<string>>(new Set());

// Available tools are the same for every session; load once.
async function loadAvailableTools() {
  try {
    const res = await fetch("/api/tools");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    availableTools.value = (await res.json()).tools ?? [];
  } catch {
    availableTools.value = [];
  }
}
loadAvailableTools();

function callKey(c: ToolCall, i: number): string {
  return c.toolUseId ?? `${c.toolName}-${i}`;
}

// Insert or update a call, keyed by tool_use_id (a PostToolUse completes the
// "running" entry its PreToolUse created).
function upsert(call: ToolCall) {
  const list = toolCalls.value;
  const idx = call.toolUseId ? list.findIndex((c) => c.toolUseId === call.toolUseId) : -1;
  if (idx >= 0) list[idx] = call;
  else toolCalls.value = [...list, call];
}

async function loadHistory(id: string) {
  try {
    const res = await fetch(`/api/tool-calls/${encodeURIComponent(id)}`);
    // Guard against a session-switch race: if the user moved on while this was in
    // flight, drop the stale response instead of clobbering the new session's pane.
    if (id !== props.sessionId) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (id !== props.sessionId) return;
    toolCalls.value = data.toolCalls ?? [];
  } catch {
    if (id === props.sessionId) toolCalls.value = [];
  }
}

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | undefined;

function subscribeTo(id: string | null) {
  unsubscribe?.();
  unsubscribe = undefined;
  if (!id) return;
  unsubscribe = subscribe(`toolcalls:${id}`, (data) => upsert(data as ToolCall));
}

watch(
  () => props.sessionId,
  (id) => {
    expandedCalls.value = new Set();
    if (id) loadHistory(id);
    else toolCalls.value = [];
    subscribeTo(id);
  },
  { immediate: true }
);

onUnmounted(() => unsubscribe?.());

function toggleTool(name: string) {
  const next = new Set(expandedTools.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  expandedTools.value = next;
}
function toggleCall(key: string) {
  const next = new Set(expandedCalls.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedCalls.value = next;
}

function formatTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// Copy the WHOLE tool-call history (arguments + results) as pretty JSON — handy
// to paste into a bug report / share when a run goes sideways. Mirrors
// MulmoClaude's RightSidebar copy-history button.
const historyCopied = ref(false);
let historyCopyTimer: ReturnType<typeof window.setTimeout> | undefined;
async function copyHistory(): Promise<void> {
  if (toolCalls.value.length === 0) return;
  try {
    await window.navigator.clipboard.writeText(JSON.stringify(toolCalls.value, null, 2));
    historyCopied.value = true;
    window.clearTimeout(historyCopyTimer);
    historyCopyTimer = window.setTimeout(() => {
      historyCopied.value = false;
    }, 2000);
  } catch {
    // Clipboard blocked (insecure context / permissions) — leave the hint off.
  }
}
onUnmounted(() => window.clearTimeout(historyCopyTimer));
</script>

<template>
  <section class="tools-pane">
    <div class="header">
      <span class="title">Tools</span>
    </div>
    <div class="content">
      <!-- Available tools -->
      <div class="section">
        <div class="section-title">
          Available Tools
        </div>
        <div v-if="availableTools.length === 0" class="muted">
          No GUI plugin tools enabled.
        </div>
        <div v-for="tool in availableTools" :key="tool.toolName" class="tool">
          <button class="tool-head" type="button" @click="toggleTool(tool.toolName)">
            <code class="tool-name">{{ tool.toolName }}</code>
            <span v-if="tool.description" class="caret">{{ expandedTools.has(tool.toolName) ? "▲" : "▼" }}</span>
          </button>
          <div v-if="expandedTools.has(tool.toolName)" class="tool-desc">
            {{ tool.description }}
          </div>
        </div>
      </div>

      <!-- Tool call history -->
      <div class="section">
        <div class="section-title section-title--with-action">
          <span>Tool Call History</span>
          <button
            class="copy-history"
            type="button"
            :disabled="toolCalls.length === 0"
            :title="historyCopied ? 'Copied!' : 'Copy all call history'"
            :aria-label="historyCopied ? 'Copied!' : 'Copy all call history'"
            @click="copyHistory"
          >
            {{ historyCopied ? "✓ Copied" : "Copy all" }}
          </button>
        </div>
        <div v-if="toolCalls.length === 0" class="muted">
          No tool calls yet.
        </div>
        <div v-for="(call, i) in toolCalls" :key="callKey(call, i)" class="call">
          <button class="call-head" type="button" @click="toggleCall(callKey(call, i))">
            <code class="call-name">{{ call.toolName }}</code>
            <span class="call-meta">
              <span v-if="call.status === 'running'" class="badge running">running…</span>
              <span v-else-if="call.status === 'failed'" class="badge failed">failed</span>
              <span v-else class="badge done">{{ call.durationMs != null ? `${call.durationMs} ms` : "done" }}</span>
              <span class="time">{{ formatTime(call.at) }}</span>
            </span>
          </button>
          <div v-if="expandedCalls.has(callKey(call, i))" class="call-body">
            <div class="label">
              arguments
            </div>
            <pre class="block">{{ formatValue(call.toolInput) }}</pre>
            <template v-if="call.status === 'completed' || call.status === 'failed'">
              <div class="label">
                {{ call.status === 'failed' ? 'error' : 'result' }}
              </div>
              <pre class="block" :class="call.status === 'failed' ? 'error' : 'result'">{{ formatValue(call.toolOutput) || "(no output)" }}</pre>
            </template>
            <div v-else class="muted italic">
              Waiting for result…
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.tools-pane {
  display: flex;
  flex-direction: column;
  width: 340px;
  flex-shrink: 0;
  height: 100%;
  background: #0d1124;
  border-left: 1px solid #2a2a4e;
}

.header {
  padding: 8px 16px;
  background: #16213e;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 14px;
}
.title {
  font-weight: 600;
}

.content {
  flex: 1;
  overflow-y: auto;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 13px;
}

.section {
  border-bottom: 1px solid #2a2a4e;
  padding: 10px 12px;
}
.section-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #7c87a8;
  margin-bottom: 8px;
}
.section-title--with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.copy-history {
  font-size: 10px;
  font-weight: 600;
  text-transform: none;
  letter-spacing: 0.02em;
  color: #9aa5c4;
  background: #1d2b4e;
  border: 1px solid #2a2a4e;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  transition:
    color 0.15s,
    background 0.15s;
}
.copy-history:hover:not(:disabled) {
  color: #cfe0ff;
  background: #243763;
}
.copy-history:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.muted {
  color: #7c87a8;
  font-size: 12px;
}
.italic {
  font-style: italic;
}

/* Available tools */
.tool + .tool {
  margin-top: 4px;
}
.tool-head,
.call-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: none;
  border: none;
  padding: 4px 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
}
.tool-name,
.call-name {
  background: #1d2b4e;
  color: #cfe0ff;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  word-break: break-all;
}
.caret {
  color: #7c87a8;
  font-size: 10px;
}
.tool-desc {
  color: #9aa5c4;
  font-size: 12px;
  margin: 2px 0 6px;
  white-space: pre-wrap;
}

/* Tool call history */
.call {
  border: 1px solid #2a2a4e;
  border-radius: 6px;
  padding: 6px 8px;
  margin-top: 6px;
  background: #11162a;
}
.call-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
}
.badge.running {
  background: #4a3a10;
  color: #ffcc80;
}
.badge.done {
  background: #14361c;
  color: #a5d6a7;
}
.badge.failed {
  background: #4a1414;
  color: #ef9a9a;
}
.time {
  color: #6b769a;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.call-body {
  margin-top: 6px;
}
.label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #7c87a8;
  margin: 6px 0 2px;
}
.block {
  background: #0a0e1f;
  border: 1px solid #20284a;
  border-radius: 4px;
  padding: 6px 8px;
  margin: 0;
  max-height: 220px;
  overflow: auto;
  font-family: "JetBrains Mono", monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.block.result {
  border-color: #1c3a24;
}
.block.error {
  border-color: #4a1414;
  color: #ef9a9a;
}
</style>
