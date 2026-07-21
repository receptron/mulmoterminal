<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import { useSessionFeed } from "../composables/useSessionFeed";

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
const emit = defineEmits<{ close: [] }>();

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

// Keying by tool_use_id lets a PostToolUse complete the "running" entry its
// PreToolUse created.
useSessionFeed(toolCalls, {
  sessionId: () => props.sessionId,
  historyUrl: (id) => `/api/tool-calls/${encodeURIComponent(id)}`,
  historyKey: "toolCalls",
  channel: (id) => `toolcalls:${id}`,
  identify: (call) => call.toolUseId,
  onSessionChange: () => {
    expandedCalls.value = new Set();
  },
});

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
  <section class="flex h-full w-[340px] shrink-0 flex-col border-l border-border bg-deep">
    <div class="flex items-center justify-between bg-panel px-4 py-2 font-sans text-[14px] text-fg">
      <span class="font-semibold">Tools</span>
      <button
        type="button"
        class="cursor-pointer rounded border-0 bg-transparent px-1 py-0.5 text-[15px] leading-none text-dim hover:text-fg"
        title="Close tools pane"
        aria-label="Close tools pane"
        @click="emit('close')"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto font-sans text-[13px] text-fg">
      <!-- Available tools -->
      <div class="border-b border-border px-3 py-2.5">
        <div class="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-dim">Available Tools</div>
        <div v-if="availableTools.length === 0" class="text-[12px] text-dim">No GUI plugin tools enabled.</div>
        <div v-for="tool in availableTools" :key="tool.toolName" class="[&+&]:mt-1">
          <button
            class="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-0 py-1 text-left text-inherit"
            type="button"
            @click="toggleTool(tool.toolName)"
          >
            <code
              data-testid="tool-name"
              class="rounded-[4px] bg-subtle px-1.5 py-0.5 font-['JetBrains_Mono',_monospace] text-[12px] break-all text-secondary"
              >{{ tool.toolName }}</code
            >
            <span v-if="tool.description" class="material-symbols-outlined text-[18px] text-dim">{{
              expandedTools.has(tool.toolName) ? "expand_less" : "expand_more"
            }}</span>
          </button>
          <div v-if="expandedTools.has(tool.toolName)" class="mb-1.5 mt-0.5 whitespace-pre-wrap text-[12px] text-muted">
            {{ tool.description }}
          </div>
        </div>
      </div>

      <!-- Tool call history -->
      <div class="border-b border-border px-3 py-2.5">
        <div class="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.04em] text-dim">
          <span>Tool Call History</span>
          <button
            class="inline-flex cursor-pointer items-center gap-1 rounded-[4px] border border-border bg-subtle px-2 py-0.5 text-[10px] font-semibold normal-case tracking-[0.02em] text-muted enabled:hover:bg-selected-hover enabled:hover:text-secondary disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            :disabled="toolCalls.length === 0"
            :title="historyCopied ? 'Copied!' : 'Copy all call history'"
            :aria-label="historyCopied ? 'Copied!' : 'Copy all call history'"
            @click="copyHistory"
          >
            <span class="material-symbols-outlined text-[14px] transition-[color,background] duration-150 ease-[ease]">{{
              historyCopied ? "check" : "content_copy"
            }}</span>
            {{ historyCopied ? "Copied" : "Copy all" }}
          </button>
        </div>
        <div v-if="toolCalls.length === 0" class="text-[12px] text-dim">No tool calls yet.</div>
        <div v-for="(call, i) in toolCalls" :key="callKey(call, i)" data-testid="tool-call" class="mt-1.5 rounded-md border border-border bg-deep px-2 py-1.5">
          <button
            class="flex w-full cursor-pointer items-center justify-between gap-2 border-0 bg-transparent px-0 py-1 text-left text-inherit"
            type="button"
            @click="toggleCall(callKey(call, i))"
          >
            <code class="rounded-[4px] bg-subtle px-1.5 py-0.5 font-['JetBrains_Mono',_monospace] text-[12px] break-all text-secondary">{{
              call.toolName
            }}</code>
            <span class="flex shrink-0 items-center gap-2">
              <span
                v-if="call.status === 'running'"
                data-testid="badge-running"
                class="rounded-full bg-[var(--warn-bg-subtle)] px-1.5 py-px text-[10px] text-warn"
                >running…</span
              >
              <span v-else-if="call.status === 'failed'" data-testid="badge-failed" class="rounded-full bg-[var(--err-bg)] px-1.5 py-px text-[10px] text-err"
                >failed</span
              >
              <span v-else data-testid="badge-done" class="rounded-full bg-[var(--ok-bg-subtle)] px-1.5 py-px text-[10px] text-ok">{{
                call.durationMs != null ? `${call.durationMs} ms` : "done"
              }}</span>
              <span class="text-[11px] tabular-nums text-dim">{{ formatTime(call.at) }}</span>
            </span>
          </button>
          <div v-if="expandedCalls.has(callKey(call, i))" class="mt-1.5">
            <div class="mb-0.5 mt-1.5 text-[10px] uppercase tracking-[0.04em] text-dim">arguments</div>
            <pre
              class="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[4px] border border-border bg-deep px-2 py-1.5 font-['JetBrains_Mono',_monospace] text-[11.5px] [word-break:break-word]"
              >{{ formatValue(call.toolInput) }}</pre>
            <template v-if="call.status === 'completed' || call.status === 'failed'">
              <div class="mb-0.5 mt-1.5 text-[10px] uppercase tracking-[0.04em] text-dim">
                {{ call.status === "failed" ? "error" : "result" }}
              </div>
              <pre
                class="m-0 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-[4px] border bg-deep px-2 py-1.5 font-['JetBrains_Mono',_monospace] text-[11.5px] [word-break:break-word]"
                :class="call.status === 'failed' ? 'border-[var(--err-bg)] text-err' : 'border-[var(--ok-border)]'"
                >{{ formatValue(call.toolOutput) || "(no output)" }}</pre>
            </template>
            <div v-else class="text-[12px] italic text-dim">Waiting for result…</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
