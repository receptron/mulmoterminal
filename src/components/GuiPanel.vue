<script setup lang="ts">
import { ref, computed } from "vue";
import { useSessionFeed } from "../composables/useSessionFeed";
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

// Deduping by uuid mirrors applyToolResultToSession.
const { upsert } = useSessionFeed(results, {
  sessionId: () => props.sessionId,
  historyUrl: (id) => `/api/agent/toolResults/${encodeURIComponent(id)}`,
  historyKey: "toolResults",
  channel: (id) => `session:${id}`,
  identify: (result) => result.uuid,
});

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
  <section class="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-deep">
    <div class="py-2 px-4 bg-panel text-fg font-sans text-[14px] flex items-center justify-between">
      <span class="font-semibold">Canvas</span>
      <button
        v-if="!toolsOpen"
        type="button"
        class="bg-transparent border-0 text-dim text-[15px] leading-none py-0.5 px-1 cursor-pointer rounded hover:text-fg"
        title="Tools & tool-call history"
        aria-label="Open tools pane"
        @click="emit('toggleTools')"
      >
        <span class="material-symbols-outlined">build</span>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto px-4 py-3 font-sans text-[14px] leading-normal text-fg">
      <div v-if="!hasContent" class="text-[13px] text-dim">
        Ask Claude to use <code class="rounded-[4px] bg-subtle px-[5px] py-px">presentDocument</code> or
        <code class="rounded-[4px] bg-subtle px-[5px] py-px">presentForm</code>
        to render content here.
      </div>
      <template v-for="r in results" :key="r.uuid">
        <PluginFrame v-if="getPlugin(r.toolName)" class="frame" :css="getPlugin(r.toolName)!.css" :height="getPlugin(r.toolName)!.height">
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

<!-- Adjacent-frame spacing is a sibling-combinator rule with no clean utility
     equivalent, so it stays scoped; everything else is utilities. -->
<style scoped>
.frame + .frame {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>
