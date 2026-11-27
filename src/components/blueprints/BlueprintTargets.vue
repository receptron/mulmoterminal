<script setup lang="ts">
// The build's work list, read from `.blueprint/targets.json`: what will be done, in what order, and where each
// stands. The agent writes the file; this only reads it, and only shows anything once there is one.
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { loadTargets } from "../../composables/blueprintsApi";
import { latestOnly } from "./latestOnly";
import { failureText } from "./refusalText";
import { isPullRequestUrl, targetRows, type Target, type TargetPhase } from "../../../common/blueprint/targets";
import type { BlueprintState } from "../../../common/blueprint/state";
import type { PlanStep } from "../../../common/blueprint/plan";
import { onOverlayShownAgain, useOverlayVisible } from "../../composables/overlayVisibility";

const props = defineProps<{ runId: string; steps: readonly PlanStep[]; state: BlueprintState }>();
const { t } = useI18n();

const targets = ref<Target[] | null>(null);
const problem = ref<string | null>(null);
const openId = ref<string | null>(null);

// The file is rewritten when a step ends or a round starts, which is exactly when a step's status or round moves.
const progressKey = computed(() =>
  props.steps.map((step) => `${step.id}:${props.state.steps[step.id]?.status}:${props.state.steps[step.id]?.round ?? 0}`).join("|"),
);

// A load for the round before can return after the one for this round; only the newest is shown.
const reads = latestOnly();

// Another build's list must not stay on screen while this one's loads.
watch(
  () => props.runId,
  () => {
    targets.value = null;
    problem.value = null;
    loadError.value = null;
    openId.value = null;
  },
);

// A failed read is said, not shown as "no list yet": the two look the same otherwise.
const loadError = ref<string | null>(null);

// The run's poll can answer after the screen was closed and move what this follows; showing it again reads.
const visible = useOverlayVisible();
async function load(): Promise<void> {
  if (!visible.value) return;
  const ticket = reads.take();
  const result = await loadTargets(props.runId);
  if (!reads.isLatest(ticket)) return;
  // A failed re-read keeps the list shown; the failure is said only with no list to show.
  if (!result.ok) {
    if (targets.value === null) loadError.value = failureText(t, result);
    return;
  }
  loadError.value = null;
  targets.value = result.value.targets;
  problem.value = result.value.problem;
}

watch([() => props.runId, progressKey], () => void load(), { immediate: true });
// The screen is kept while closed; what this shows may have changed in the meantime.
onOverlayShownAgain(() => void load());

const rows = computed(() => (targets.value ? targetRows(targets.value, props.steps, props.state) : []));

const PHASE_LOOK: Record<TargetPhase, { icon: string; tone: string; motion?: string }> = {
  todo: { icon: "radio_button_unchecked", tone: "text-dim" },
  working: { icon: "progress_activity", tone: "text-accent", motion: "animate-spin" },
  "needs-decision": { icon: "help", tone: "text-warn" },
  done: { icon: "check_circle", tone: "text-ok" },
  skipped: { icon: "do_not_disturb_on", tone: "text-secondary" },
};

const toggle = (id: string): void => {
  openId.value = openId.value === id ? null : id;
};
</script>

<template>
  <p v-if="loadError" class="m-0 flex items-center gap-2 font-sans text-[12px] text-err-text" data-testid="blueprint-targets-load-error">
    {{ t("blueprints.targets.loadFailed", { error: loadError }) }}
    <button
      type="button"
      data-testid="blueprint-targets-reload"
      class="cursor-pointer rounded-[4px] border border-border bg-base px-2 py-0.5 font-sans text-[12px] text-fg hover:bg-hover"
      @click="load()"
    >
      {{ t("blueprints.run.retry") }}
    </button>
  </p>
  <p v-else-if="problem" class="m-0 font-sans text-[12px] text-err-text" data-testid="blueprint-targets-problem">
    {{ t("blueprints.targets.unreadable", { problem }) }}
  </p>
  <section v-else-if="rows.length > 0" class="flex max-w-[1280px] flex-col gap-2" data-testid="blueprint-targets">
    <h3 class="m-0 font-sans text-[13px] font-[650] text-fg">{{ t("blueprints.targets.heading") }}</h3>
    <table class="w-full border-collapse font-sans text-[13px]">
      <thead>
        <tr class="border-b border-border text-left text-[12px] text-secondary">
          <th class="w-10 py-1 pr-2 font-normal">{{ t("blueprints.targets.position") }}</th>
          <th class="py-1 pr-2 font-normal">{{ t("blueprints.targets.title") }}</th>
          <th class="w-48 py-1 font-normal">{{ t("blueprints.targets.status") }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="row.target.id">
          <tr
            class="cursor-pointer border-b border-border hover:bg-hover"
            :class="row.phase === 'needs-decision' ? 'bg-[var(--warn-bg-subtle)]' : ''"
            data-testid="blueprint-target"
            :data-phase="row.phase"
            :aria-expanded="openId === row.target.id"
            tabindex="0"
            @click="toggle(row.target.id)"
            @keydown.enter.prevent="toggle(row.target.id)"
            @keydown.space.prevent="toggle(row.target.id)"
          >
            <td class="py-1.5 pr-2 text-secondary">{{ row.position }}</td>
            <td class="py-1.5 pr-2 text-fg">
              {{ row.target.title }}
              <span v-if="row.target.kind" class="ml-1.5 font-mono text-[11px] text-dim">{{ row.target.kind }}</span>
            </td>
            <td class="py-1.5">
              <span class="flex items-center gap-1.5" :class="PHASE_LOOK[row.phase].tone">
                <span class="material-symbols-outlined text-[16px]" :class="PHASE_LOOK[row.phase].motion" aria-hidden="true">{{
                  PHASE_LOOK[row.phase].icon
                }}</span>
                {{ t(`blueprints.targets.phase.${row.phase}`) }}
              </span>
            </td>
          </tr>
          <tr v-if="openId === row.target.id" class="border-b border-border" data-testid="blueprint-target-detail">
            <td></td>
            <td colspan="2" class="py-2">
              <dl class="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
                <template v-if="row.target.why">
                  <dt class="text-secondary">{{ t("blueprints.targets.why") }}</dt>
                  <dd class="m-0 text-fg">{{ row.target.why }}</dd>
                </template>
                <template v-if="row.target.proof">
                  <dt class="text-secondary">{{ t("blueprints.targets.proof") }}</dt>
                  <dd class="m-0 text-fg">{{ row.target.proof }}</dd>
                </template>
                <template v-if="row.target.files.length">
                  <dt class="text-secondary">{{ t("blueprints.targets.files") }}</dt>
                  <dd class="m-0 font-mono text-fg">{{ row.target.files.join(", ") }}</dd>
                </template>
                <template v-if="isPullRequestUrl(row.target.pr)">
                  <dt class="text-secondary">{{ t("blueprints.targets.pr") }}</dt>
                  <dd class="m-0">
                    <a :href="row.target.pr" target="_blank" rel="noopener noreferrer" class="text-accent hover:underline" data-testid="blueprint-target-pr">{{
                      row.target.pr
                    }}</a>
                  </dd>
                </template>
                <template v-if="row.target.note">
                  <dt class="text-secondary">{{ t("blueprints.targets.note") }}</dt>
                  <dd class="m-0 text-fg">{{ row.target.note }}</dd>
                </template>
              </dl>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>
</template>
