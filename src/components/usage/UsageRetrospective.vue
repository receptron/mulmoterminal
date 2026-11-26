<script setup lang="ts">
// The retrospective (#3335): what the last weeks went on — money, tokens, conversations, the PRs they
// made — by week, project, agent and model, from the Library's index. Numbers to read, with a quiet bar beside each
// week; no chart library. Read once each time /usage opens.
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { LibraryRetrospective } from "../../../common/libraryRetrospective";
import { loadRetrospective } from "../../composables/libraryApi";

const { t, locale } = useI18n();
const totals = ref<LibraryRetrospective | null>(null);
const failed = ref(false);
/** Projects listed at most: the rest is the long tail of one-off directories. */
const PROJECTS_SHOWN = 8;
const PERCENT = 100;

void (async () => {
  const read = await loadRetrospective();
  totals.value = read;
  failed.value = read === null;
})();

const tokenCount = (tokens: number): string =>
  new Intl.NumberFormat(locale.value, { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(tokens));
const modelName = (model: string): string => (model === "" ? t("usageView.retro.unknownModel") : model);
const money = (usd: number): string => new Intl.NumberFormat(locale.value, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(usd);
const weekLabel = (start_ms: number): string => new Date(start_ms).toLocaleDateString(locale.value, { month: "numeric", day: "numeric" });
const projectName = (cwd: string): string => (cwd === "" ? t("usageView.retro.noProject") : (cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd));
const widest = computed(() => Math.max(...(totals.value?.weeks ?? []).map((week) => week.costUsd), 0));
const barWidth = (usd: number): string => `${widest.value === 0 ? 0 : Math.round((usd / widest.value) * PERCENT)}%`;
const projects = computed(() => (totals.value?.projects ?? []).slice(0, PROJECTS_SHOWN));
const CELL = "py-1 pr-4 text-right font-mono tabular-nums";
const HEAD = "py-1 pr-4 text-right font-[550]";
const HEAD_LAST = "py-1 text-right font-[550]";
/** The money, conversation and PR columns the week and project tables both end with. */
const COUNT_HEADS = ["usageView.retro.cost", "usageView.retro.conversations", "usageView.retro.prs"] as const;
</script>

<template>
  <section class="mt-6 font-sans text-[13px]" data-testid="usage-retro">
    <h2 class="m-0 text-[14px] font-[650] text-fg">{{ t("usageView.retro.title") }}</h2>
    <p v-if="failed" class="m-0 mt-2 text-err-text">{{ t("usageView.retro.failed") }}</p>
    <p v-else-if="totals === null" class="m-0 mt-2 text-dim">{{ t("usageView.retro.loading") }}</p>
    <template v-else>
      <p class="m-0 mt-1 text-[12px] text-secondary" data-testid="usage-retro-total">
        {{ t("usageView.retro.total", { cost: money(totals.total.costUsd), conversations: totals.total.conversations, prs: totals.total.prs }) }}
      </p>
      <p class="m-0 mt-0.5 text-[12px] text-secondary" data-testid="usage-retro-tokens">
        {{
          t("usageView.retro.tokens", {
            input: tokenCount(totals.total.tokens.input),
            output: tokenCount(totals.total.tokens.output),
            cacheRead: tokenCount(totals.total.tokens.cacheRead),
            cacheWrite: tokenCount(totals.total.tokens.cacheWrite),
          })
        }}
      </p>
      <table class="mt-3 w-full max-w-[720px] border-collapse" data-testid="usage-retro-weeks">
        <thead>
          <tr class="border-b border-border text-left text-[12px] text-secondary">
            <th class="py-1 pr-4 font-[550]">{{ t("usageView.retro.week") }}</th>
            <th class="w-full py-1 pr-4 font-[550]"></th>
            <th v-for="(label, index) in COUNT_HEADS" :key="label" :class="index === COUNT_HEADS.length - 1 ? HEAD_LAST : HEAD">{{ t(label) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="week in totals.weeks" :key="week.start_ms" class="border-b border-border">
            <td class="whitespace-nowrap py-1 pr-4 text-secondary">{{ weekLabel(week.start_ms) }}</td>
            <td class="py-1 pr-4">
              <div class="h-1.5 rounded-full bg-accent" :style="{ width: barWidth(week.costUsd) }"></div>
            </td>
            <td :class="CELL">{{ money(week.costUsd) }}</td>
            <td :class="CELL">{{ week.conversations }}</td>
            <td class="py-1 text-right font-mono tabular-nums">{{ week.prs }}</td>
          </tr>
        </tbody>
      </table>
      <div class="mt-5 flex flex-wrap gap-8">
        <table class="border-collapse" data-testid="usage-retro-projects">
          <thead>
            <tr class="border-b border-border text-left text-[12px] text-secondary">
              <th class="py-1 pr-4 font-[550]">{{ t("usageView.retro.project") }}</th>
              <th v-for="(label, index) in COUNT_HEADS" :key="label" :class="index === COUNT_HEADS.length - 1 ? HEAD_LAST : HEAD">{{ t(label) }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in projects" :key="project.cwd" class="border-b border-border">
              <td class="max-w-[240px] truncate py-1 pr-4 text-fg" :data-tip="project.cwd">{{ projectName(project.cwd) }}</td>
              <td :class="CELL">{{ money(project.costUsd) }}</td>
              <td :class="CELL">{{ project.conversations }}</td>
              <td class="py-1 text-right font-mono tabular-nums">{{ project.prs }}</td>
            </tr>
          </tbody>
        </table>
        <table class="border-collapse" data-testid="usage-retro-agents">
          <thead>
            <tr class="border-b border-border text-left text-[12px] text-secondary">
              <th class="py-1 pr-4 font-[550]">{{ t("usageView.retro.agent") }}</th>
              <th class="py-1 pr-4 text-right font-[550]">{{ t("usageView.retro.cost") }}</th>
              <th class="py-1 text-right font-[550]">{{ t("usageView.retro.conversations") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="agent in totals.agents" :key="agent.agent" class="border-b border-border">
              <td class="py-1 pr-4 text-fg">{{ agent.agent }}</td>
              <td :class="CELL">{{ money(agent.costUsd) }}</td>
              <td class="py-1 text-right font-mono tabular-nums">{{ agent.conversations }}</td>
            </tr>
          </tbody>
        </table>
        <table class="border-collapse" data-testid="usage-retro-models">
          <thead>
            <tr class="border-b border-border text-left text-[12px] text-secondary">
              <th class="py-1 pr-4 font-[550]">{{ t("usageView.retro.model") }}</th>
              <th class="py-1 pr-4 text-right font-[550]">{{ t("usageView.retro.cost") }}</th>
              <th class="py-1 pr-4 text-right font-[550]">{{ t("usageView.retro.input") }}</th>
              <th class="py-1 pr-4 text-right font-[550]">{{ t("usageView.retro.output") }}</th>
              <th class="py-1 pr-4 text-right font-[550]">{{ t("usageView.retro.cacheRead") }}</th>
              <th class="py-1 text-right font-[550]">{{ t("usageView.retro.cacheWrite") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="model in totals.models" :key="model.model" class="border-b border-border">
              <td class="py-1 pr-4 text-fg">{{ modelName(model.model) }}</td>
              <td :class="CELL">{{ money(model.costUsd) }}</td>
              <td :class="CELL">{{ tokenCount(model.tokens.input) }}</td>
              <td :class="CELL">{{ tokenCount(model.tokens.output) }}</td>
              <td :class="CELL">{{ tokenCount(model.tokens.cacheRead) }}</td>
              <td class="py-1 text-right font-mono tabular-nums">{{ tokenCount(model.tokens.cacheWrite) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="m-0 mt-3 text-[11px] text-dim">{{ t("usageView.retro.note") }}</p>
    </template>
  </section>
</template>
