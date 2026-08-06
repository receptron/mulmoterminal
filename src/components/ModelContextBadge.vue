<script setup lang="ts">
import { computed } from "vue";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { modelBadge, shortModelLabel, type BadgeAgent, type ModelBadge } from "./modelBadge";
import { badgeTip } from "./tipContent";

// Which model is running + how full its context is, e.g. `Opus · ctx 35%`. Nothing renders until
// the transcript has told us the model; the text and the tip's wording are decided in ./modelBadge.
const props = defineProps<{
  agent: BadgeAgent;
  model: string | null;
  contextTokens: number;
  /** The window the agent stated, when it stated one — codex does, Claude does not. `undefined`
   *  is admitted rather than made optional: it arrives off the wire object, where the field is
   *  simply absent for every other agent. */
  contextWindow: number | null | undefined;
}>();

const MODEL_ONLY_AGENT_NAME: Partial<Record<BadgeAgent, string>> = { claude: "Claude", codex: "Codex" };

function paneBadge(agent: BadgeAgent, model: string, contextTokens: number, contextWindow: number | null | undefined): ModelBadge {
  const agentName = MODEL_ONLY_AGENT_NAME[agent];
  if (agentName) return { text: shortModelLabel(model), title: `${agentName} · ${model}` };
  return modelBadge(agent, model, contextTokens, contextWindow);
}

const badge = computed(() => (props.model ? paneBadge(props.agent, props.model, props.contextTokens, props.contextWindow) : null));

// The badge shortens the model to `Opus`; the tip keeps the full name. Token counts stay out of
// Claude/Codex pane chrome, while the other agents retain their existing context reading.
const { described, show: showTip, hide: hideTip } = useHoverTipAnchor(() => badgeTip(badge.value?.title ?? ""));
</script>

<template>
  <span
    v-if="badge"
    data-testid="model-badge"
    class="flex-none whitespace-nowrap font-mono text-[10px] tracking-[0.02em] text-dim"
    :aria-describedby="described ? HOVER_TIP_ID : undefined"
    @pointerenter="showTip"
    @pointerleave="hideTip"
    @focusin="showTip"
    @focusout="hideTip"
    >{{ badge.text }}</span
  >
</template>
