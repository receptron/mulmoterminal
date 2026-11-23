<script setup lang="ts">
// One card on the GitHub board (#3172): the issue, the PR that closes it, where it stands in review,
// and the live terminals on its branch. Pressing the card opens its detail panel (#3177); GitHub is
// reached from there.
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { mergeConditionMet, type BoardCard } from "../../common/githubBoard";
import { ciDotClass } from "./ciDot";
import GithubBoardCells from "./GithubBoardCells.vue";
import IssueStartButton from "./IssueStartButton.vue";
import type { IssueStartOptions } from "../composables/useIssueStart";
import { cardWaiting } from "./boardLive";

const props = defineProps<{ repo: string; card: BoardCard; home: string | null; selected: boolean }>();

const emit = defineEmits<{ (e: "select" | "started"): void }>();

// From the board the issue is sent at once and the board stays on screen (#3179); the cell appears
// in the grid behind it and on this card once the board reloads.
const BOARD_START: IssueStartOptions = { run: true, reveal: false };

const { t } = useI18n();

const review = computed(() => (props.card.pr?.review ?? "").toUpperCase());

const waiting = computed(() => cardWaiting(props.card));

const codex = computed(() => props.card.pr?.codex ?? null);

const mergeReady = computed(() => props.card.column !== "merged" && props.card.pr !== null && mergeConditionMet(props.card.pr));

// gh returns a PR's first comments and reviews only, so a list at its cap may miss later verdicts.
const codexCount = computed(() => {
  if (!codex.value) return "";
  return codex.value.more ? `${codex.value.verdicts}+` : String(codex.value.verdicts);
});

// Only a verdict on the current head speaks for the PR as it is; an older one is shown, but quietly.
const codexClass = computed(() => {
  if (codex.value?.head !== "current") return "border-border text-muted";
  if (codex.value.latest === "lgtm") return "border-[#3fae6b] text-[#3fae6b]";
  return "border-err-text text-err-text";
});

const borderClass = computed(() => {
  if (props.selected) return "border-accent";
  return waiting.value ? "border-amber" : "border-border";
});
</script>

<template>
  <article
    data-testid="board-card"
    class="flex flex-col gap-1.5 rounded-md border bg-panel px-2.5 py-2 text-[12px] text-secondary"
    :class="borderClass"
    :data-waiting="waiting || undefined"
  >
    <span v-if="waiting" data-testid="board-card-waiting" class="flex items-center gap-1 text-[11px] font-semibold text-amber">
      <span class="material-symbols-outlined text-[14px]" aria-hidden="true">front_hand</span>
      {{ t("githubBoard.cell.waiting") }}
    </span>
    <button
      type="button"
      data-testid="board-card-open"
      class="flex min-w-0 cursor-pointer flex-col gap-1.5 border-0 bg-transparent p-0 text-left text-[12px] text-secondary hover:text-fg"
      :aria-expanded="selected"
      :aria-label="t('githubBoard.detail.open')"
      @click="emit('select')"
    >
      <span v-if="card.issue" class="flex w-full min-w-0 gap-1.5 text-fg">
        <span class="flex-none font-mono text-dim">#{{ card.issue.number }}</span>
        <span v-if="card.issue.title" class="min-w-0 truncate">{{ card.issue.title }}</span>
      </span>
      <span v-if="card.pr" class="flex w-full min-w-0 items-center gap-1.5" :class="card.issue ? 'text-secondary' : 'text-fg'">
        <span
          class="h-[8px] w-[8px] flex-none rounded-full"
          :class="ciDotClass(card.pr.ci)"
          role="img"
          :aria-label="t(`githubBoard.ci.${card.pr.ci}`)"
          :data-tip="t(`githubBoard.ci.${card.pr.ci}`)"
        />
        <span class="flex-none font-mono text-dim">PR #{{ card.pr.number }}</span>
        <span class="min-w-0 truncate">{{ card.pr.title }}</span>
      </span>
      <span v-if="card.branch" class="w-full truncate font-mono text-[11px] text-dim">⎇ {{ card.branch }}</span>
    </button>
    <div v-if="card.pr" class="flex flex-wrap items-center gap-1 text-[11px]">
      <span
        v-if="mergeReady"
        data-testid="board-merge-ready"
        class="flex items-center gap-0.5 rounded border border-[#3fae6b] bg-[#3fae6b]/10 px-1.5 font-semibold text-[#3fae6b]"
        :data-tip="t('githubBoard.mergeReadyTip')"
      >
        <span class="material-symbols-outlined text-[13px]" aria-hidden="true">merge</span>
        {{ t("githubBoard.mergeReady") }}
      </span>
      <span v-if="card.pr.isDraft" class="rounded border border-border px-1.5 text-muted">{{ t("githubBoard.draft") }}</span>
      <span v-if="review === 'CHANGES_REQUESTED'" class="rounded border border-err-text px-1.5 text-err-text">{{ t("githubBoard.changesRequested") }}</span>
      <span v-if="review === 'APPROVED'" class="rounded border border-[#3fae6b] px-1.5 text-[#3fae6b]">{{ t("githubBoard.approved") }}</span>
      <span v-if="card.pr.reviewRounds > 0" data-testid="board-review-round" class="rounded border border-border px-1.5 text-muted">{{
        t("githubBoard.reviewRound", { count: card.pr.reviewRounds })
      }}</span>
      <span v-if="codex" data-testid="board-codex" class="rounded border px-1.5" :class="codexClass">{{
        t(`githubBoard.codex.${codex.latest}`, { count: codexCount })
      }}</span>
      <span v-if="codex && codex.head !== 'current'" data-testid="board-codex-head" class="text-dim">{{ t(`githubBoard.codex.${codex.head}`) }}</span>
      <span v-if="card.column === 'review' && !card.pr.headReviewed" class="text-dim">{{ t("githubBoard.awaitingReview") }}</span>
    </div>
    <div v-if="card.column === 'todo' && card.issue" class="flex items-center gap-1.5 text-[11px] text-dim">
      <IssueStartButton :repo="repo" :issue="card.issue.number" :options="BOARD_START" @started="emit('started')" />
      {{ t("githubBoard.start") }}
    </div>
    <GithubBoardCells v-if="card.cells.length" :cells="card.cells" :home="home" />
    <div v-else-if="card.column !== 'todo' && card.column !== 'merged'" class="text-[11px] text-dim">{{ t("githubBoard.noCell") }}</div>
  </article>
</template>
