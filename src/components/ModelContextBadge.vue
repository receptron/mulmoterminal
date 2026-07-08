<script setup lang="ts">
import { computed } from "vue";

// Which model is running + how full its context is, e.g. `Opus · ctx 35%`. Model
// and contextTokens come from the transcript (server /api/session/:id); the agent
// kind is known client-side. Unknown models keep the label but hide the %.
const props = defineProps<{
  agent: "claude" | "codex";
  model: string | null;
  contextTokens: number;
}>();

// Substring → short label for Claude's model families; matched case-insensitively.
// Anything else (a codex model, a future provider) falls back to the id's tail.
const CLAUDE_FAMILIES = [
  { match: "opus", label: "Opus" },
  { match: "sonnet", label: "Sonnet" },
  { match: "haiku", label: "Haiku" },
];

// Approximate context window per model family, in tokens. A model with no entry
// here shows its label but no % — we never guess a window.
const CONTEXT_WINDOW_TOKENS: Record<string, number> = { opus: 200_000, sonnet: 200_000, haiku: 200_000 };
const PERCENT = 100;

const AGENT_NAME: Record<"claude" | "codex", string> = { claude: "Claude", codex: "Codex" };

function shortModelLabel(model: string): string {
  const lower = model.toLowerCase();
  const family = CLAUDE_FAMILIES.find((f) => lower.includes(f.match));
  return family ? family.label : (model.split("/").pop() ?? model);
}

function contextWindowTokens(model: string): number | null {
  const lower = model.toLowerCase();
  const key = Object.keys(CONTEXT_WINDOW_TOKENS).find((k) => lower.includes(k));
  return key ? CONTEXT_WINDOW_TOKENS[key] : null;
}

const label = computed(() => (props.model ? shortModelLabel(props.model) : null));
const windowTokens = computed(() => (props.model ? contextWindowTokens(props.model) : null));
const ctxPercent = computed(() => (windowTokens.value ? Math.round((props.contextTokens / windowTokens.value) * PERCENT) : null));
const badgeText = computed(() => (ctxPercent.value !== null ? `${label.value} · ctx ${ctxPercent.value}%` : label.value));

const title = computed(() => {
  if (!props.model) return "";
  const used = props.contextTokens.toLocaleString();
  const window = windowTokens.value ? ` / ${windowTokens.value.toLocaleString()} (${ctxPercent.value}%)` : "";
  return `${AGENT_NAME[props.agent]} · ${props.model} · context ${used}${window} tokens`;
});
</script>

<template>
  <span v-if="label" class="cell-model" :title="title">{{ badgeText }}</span>
</template>

<style scoped>
/* Mirrors .cell-usage: dim, monospace metadata that reads as a quiet header badge. */
.cell-model {
  flex: 0 0 auto;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
  letter-spacing: 0.02em;
}
</style>
