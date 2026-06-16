<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from "vue";
import { usePubSub } from "../composables/usePubSub";
import { getPlugin } from "../plugins-registry";
import PluginFrame from "./PluginFrame.vue";

// The GUI panel renders the toolResults produced by GUI-protocol plugins. It
// mirrors the terminal's active session: live results arrive on that session's
// pub/sub channel, history is replayed from /api/agent/toolResults/:id on (re)select.
// Each result is rendered by its plugin's viewComponent (getPlugin(toolName)) — no
// hard-coded type switch. See the spike doc.
interface ToolResult {
  uuid: string;
  toolName: string;
  title?: string;
  message?: string;
  data?: unknown;
  jsonData?: unknown;
  viewState?: unknown;
}

const props = defineProps<{
  sessionId: string | null;
  sendTextMessage: (text: string) => boolean;
  toolsOpen?: boolean;
}>();
const emit = defineEmits<{ toggleTools: [] }>();

const results = ref<ToolResult[]>([]);

const sessionChannel = (id: string) => `session:${id}`;

// Insert or update a result, deduped by uuid (a re-emitted result — e.g. a form
// whose viewState changed — updates in place). Mirrors applyToolResultToSession.
function upsert(result: ToolResult) {
  const idx = results.value.findIndex((r) => r.uuid === result.uuid);
  if (idx >= 0) results.value[idx] = result;
  else results.value = [...results.value, result];
}

async function loadHistory(id: string) {
  try {
    const res = await fetch(`/api/agent/toolResults/${encodeURIComponent(id)}`);
    // Guard against a session-switch race: a slow response for an old session must
    // not clobber the pane after the user has switched to a newer one.
    if (id !== props.sessionId) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (id !== props.sessionId) return;
    results.value = data.toolResults ?? [];
  } catch {
    if (id === props.sessionId) results.value = [];
  }
}

const { subscribe } = usePubSub();
let unsubscribe: (() => void) | undefined;

function subscribeTo(id: string | null) {
  unsubscribe?.();
  unsubscribe = undefined;
  if (!id) return;
  unsubscribe = subscribe(sessionChannel(id), (data) => upsert(data as ToolResult));
}

// Reload history + re-subscribe whenever the active session changes (and clear
// for a fresh, not-yet-identified session).
watch(
  () => props.sessionId,
  (id) => {
    if (id) loadHistory(id);
    else results.value = [];
    subscribeTo(id);
  },
  { immediate: true }
);

onUnmounted(() => unsubscribe?.());

// A plugin view changed its state (e.g. a form field edited / submitted). Per the
// gui-chat-protocol contract the view may emit a PARTIAL ToolResult (e.g. just
// `{ viewState }`), so merge it into the existing result rather than replacing —
// otherwise data/jsonData/uuid/toolName would be lost.
//
// `persistOnly` is a deliberate trade-off: the view emits on every change, and
// without it the server would re-publish on the session channel straight back to
// THIS panel — the echo arrives with fresh object identity, the view treats it as a
// new result and re-seeds, re-emitting → an infinite flicker loop. So we suppress
// the broadcast and rely on the local upsert() above. The cost: a second browser
// tab on the same session won't see live view-state updates (it picks them up on
// reload from the stored result) — acceptable for a local single-client tool.
async function onUpdateResult(existing: ToolResult, update: Partial<ToolResult>) {
  const merged: ToolResult = { ...existing, ...update };
  upsert(merged);
  if (!props.sessionId) return;
  try {
    await fetch("/api/agent/toolResult", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...merged, sessionId: props.sessionId, persistOnly: true }),
    });
  } catch {
    // Best-effort persistence; the live view already updated.
  }
}

const hasContent = computed(() => results.value.length > 0);
</script>

<template>
  <section class="gui-panel">
    <div class="header">
      <span class="title">GUI</span>
      <button
        type="button"
        class="gear"
        :class="{ active: toolsOpen }"
        title="Tools & tool-call history"
        aria-label="Toggle tools pane"
        :aria-pressed="toolsOpen ? 'true' : 'false'"
        @click="emit('toggleTools')"
      >
        ⚙
      </button>
    </div>
    <div class="content">
      <div v-if="!hasContent" class="empty">
        Ask Claude to use <code>presentDocument</code> or <code>presentForm</code>
        to render content here.
      </div>
      <template v-for="r in results" :key="r.uuid">
        <PluginFrame v-if="getPlugin(r.toolName)" class="frame" :css="getPlugin(r.toolName)!.css">
          <component
            :is="getPlugin(r.toolName)!.viewComponent"
            :selected-result="r"
            :send-text-message="sendTextMessage"
            @update-result="(update: Partial<ToolResult>) => onUpdateResult(r, update)"
          />
        </PluginFrame>
      </template>
    </div>
  </section>
</template>

<style scoped>
.gui-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  height: 100%;
  background: #11162a;
  border-left: 1px solid #2a2a4e;
}

.header {
  padding: 8px 16px;
  background: #16213e;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-weight: 600;
}
.gear {
  background: none;
  border: none;
  color: #7c87a8;
  font-size: 15px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: 4px;
}
.gear:hover {
  color: #e0e0e0;
}
.gear.active {
  color: #4a8cff;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.5;
}

.empty {
  color: #7c87a8;
  font-size: 13px;
}
.empty code {
  background: #1d2b4e;
  padding: 1px 5px;
  border-radius: 4px;
}

.frame + .frame {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #2a2a4e;
}
</style>
