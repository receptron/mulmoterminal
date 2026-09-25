<script setup lang="ts">
// What the agent on a step is doing right now: its tool calls as they happen, newest first. The same
// history and live channel the tools pane reads, so a build is watched rather than waited on.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSessionFeed } from "../../composables/useSessionFeed";
import { readToolCall, type ToolCall } from "../toolCall";
import { toolCallSummary } from "./blueprintView";

const props = defineProps<{ sessionId: string }>();
const { t } = useI18n();

// Enough to see the thread of what it is doing; the tools pane has the whole history.
const SHOWN_CALLS = 8;

const calls = ref<ToolCall[]>([]);
useSessionFeed(calls, {
  sessionId: () => props.sessionId,
  historyUrl: (id) => `/api/tool-calls/${encodeURIComponent(id)}`,
  historyKey: "toolCalls",
  channel: (id) => `toolcalls:${id}`,
  identify: (call) => call.toolUseId,
  parse: readToolCall,
});

const recent = computed(() => [...calls.value].sort((a, b) => b.at - a.at).slice(0, SHOWN_CALLS));
</script>

<template>
  <div class="flex flex-col gap-1 rounded-[4px] bg-base p-2" data-testid="blueprint-live-activity" aria-live="polite">
    <p v-if="!recent.length" class="m-0 flex items-center gap-1.5 font-sans text-[12px] text-dim">
      <span class="material-symbols-outlined animate-spin text-[14px]" aria-hidden="true">progress_activity</span>
      {{ t("blueprints.run.starting") }}
    </p>
    <div v-for="call in recent" :key="call.toolUseId ?? `${call.toolName}-${call.at}`" class="flex min-w-0 items-center gap-2 font-mono text-[11px]">
      <span
        class="material-symbols-outlined flex-none text-[14px]"
        :class="call.status === 'running' ? 'animate-spin text-accent' : call.status === 'failed' ? 'text-err-text' : 'text-ok'"
        aria-hidden="true"
        >{{ call.status === "running" ? "progress_activity" : call.status === "failed" ? "error" : "check" }}</span
      >
      <span class="flex-none text-fg">{{ call.toolName }}</span>
      <span class="min-w-0 truncate text-secondary">{{ toolCallSummary(call.toolInput) }}</span>
    </div>
  </div>
</template>
