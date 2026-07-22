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
  { match: "fable", label: "Fable" },
  { match: "mythos", label: "Mythos" },
];

const MILLION_TOKENS = 1_000_000;
const K200_TOKENS = 200_000;
// Context window per model, matched as an ordered substring list (first hit wins) against the
// lowercased model id. The current Claude generation ships a 1M window — Opus 4.6+, Sonnet 4.6+,
// Fable, Mythos — so those are listed explicitly; everything else (older Opus/Sonnet, all Haiku)
// falls through to the 200k default. Add new 1M model ids here when they ship — otherwise a
// full session over-reports (e.g. a 1M model shown against 200k reads as ~500%). A model matched
// by neither list (a codex/other-provider id) shows its label but no % — we never guess a window.
const CONTEXT_WINDOWS: { match: string; tokens: number }[] = [
  { match: "opus-4-6", tokens: MILLION_TOKENS },
  { match: "opus-4-7", tokens: MILLION_TOKENS },
  { match: "opus-4-8", tokens: MILLION_TOKENS },
  { match: "sonnet-4-6", tokens: MILLION_TOKENS },
  { match: "sonnet-5", tokens: MILLION_TOKENS },
  { match: "fable", tokens: MILLION_TOKENS },
  { match: "mythos", tokens: MILLION_TOKENS },
  { match: "opus", tokens: K200_TOKENS },
  { match: "sonnet", tokens: K200_TOKENS },
  { match: "haiku", tokens: K200_TOKENS },
];
const PERCENT = 100;

const AGENT_NAME: Record<"claude" | "codex", string> = { claude: "Claude", codex: "Codex" };

function shortModelLabel(model: string): string {
  const lower = model.toLowerCase();
  const family = CLAUDE_FAMILIES.find((f) => lower.includes(f.match));
  return family ? family.label : (model.split("/").pop() ?? model);
}

function contextWindowTokens(model: string): number | null {
  const lower = model.toLowerCase();
  const entry = CONTEXT_WINDOWS.find((w) => lower.includes(w.match));
  return entry ? entry.tokens : null;
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
  <span v-if="label" data-testid="model-badge" class="flex-none font-mono text-[10px] text-dim whitespace-nowrap tracking-[0.02em]" :title="title">{{
    badgeText
  }}</span>
</template>
