<script setup lang="ts">
// The experimental GitHub board (#3172): per configured repo, five progress columns of cards from
// /api/github/board. Read when it mounts, on the reload button, and as useGithubBoardLive decides
// (#3182); the column rules are the server's (server/git/board.ts).
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { type BoardCard, type BoardColumn, type RepoBoard } from "../../common/githubBoard";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { useAppConfig } from "../composables/useAppConfig";
import GithubBoardCard from "./GithubBoardCard.vue";
import GithubBoardDetail from "./GithubBoardDetail.vue";
import IssueStartAgentPicker from "./IssueStartAgentPicker.vue";
import { useIssueStart } from "../composables/useIssueStart";
import { boardSelection, type BoardSelection } from "../composables/useGithubBoardView";
import { useGithubBoardLive } from "../composables/useGithubBoardLive";
import { useBoardOpenWorkOnly } from "../composables/useBoardOpenWorkOnly";
import { openWorkOnly, visibleColumns } from "./boardOpenWork";

const emit = defineEmits<{ (e: "close" | "list"): void }>();

const { t } = useI18n();
const { home } = useAppConfig();
const { loadRepoDirs, startError } = useIssueStart();
const { boardOpenWorkOnly, setBoardOpenWorkOnly } = useBoardOpenWorkOnly();

const repos = ref<RepoBoard[]>([]);
const loading = ref(false);
const failed = ref(false);
let requestId = 0;

const isRepoBoard = (row: unknown): row is RepoBoard => isRecord(row) && typeof row.repo === "string";

async function load(): Promise<void> {
  const id = ++requestId;
  const startedAt = readStarted();
  loading.value = true;
  try {
    const res = await fetchWithTimeout("/api/github/board", {}, SLOW_COMMAND_TIMEOUT_MS);
    const body = await jsonBody(res);
    if (id !== requestId) return;
    const rows = res.ok && isRecord(body) && isUnknownArray(body.repos) ? body.repos : null;
    failed.value = rows === null;
    // A failed read keeps the cards on screen: with the board reading itself every minute, one
    // dropped request would otherwise blank it until the next.
    if (rows) {
      repos.value = rows.filter(isRepoBoard);
      readApplied(startedAt);
    }
  } catch {
    if (id === requestId) failed.value = true;
  } finally {
    if (id === requestId) loading.value = false;
  }
}

// The cards with their cells' state as it is now, which is what every view below reads.
const { liveRepos, readStarted, readApplied } = useGithubBoardLive(repos, () => void load());
const shownRepos = computed(() => (boardOpenWorkOnly.value ? openWorkOnly(liveRepos.value) : liveRepos.value));
const onOpenWorkOnlyChange = (event: Event): void => {
  if (event.target instanceof HTMLInputElement) setBoardOpenWorkOnly(event.target.checked);
};
const nothingOpen = computed(() => boardOpenWorkOnly.value && repos.value.length > 0 && shownRepos.value.length === 0);

const cardsIn = (repo: RepoBoard, column: BoardColumn): BoardCard[] => (repo.cards ?? []).filter((card) => card.column === column);

const isSelected = (repo: RepoBoard, card: BoardCard): boolean => boardSelection.value?.repo === repo.repo && boardSelection.value.key === card.key;

const select = (repo: RepoBoard, card: BoardCard): void => {
  boardSelection.value = isSelected(repo, card) ? null : { repo: repo.repo, key: card.key };
};

const selectedCard = (selection: BoardSelection | null): BoardCard | null =>
  shownRepos.value.find((repo) => repo.repo === selection?.repo)?.cards?.find((candidate) => candidate.key === selection?.key) ?? null;

// Looked up in the latest load, so the panel follows a card's cells across a refresh.
const selected = computed(() => {
  const card = selectedCard(boardSelection.value);
  return boardSelection.value && card ? { repo: boardSelection.value.repo, card } : null;
});

// A card that has left the board takes its panel with it, so Escape is not spent on a hidden one.
watch(shownRepos, () => {
  if (boardSelection.value && !selectedCard(boardSelection.value)) boardSelection.value = null;
});

onMounted(() => void loadRepoDirs());
onBeforeUnmount(() => (boardSelection.value = null));
</script>

<template>
  <div class="flex h-full min-h-0 min-w-0 flex-col bg-deep" role="region" :aria-label="t('githubBoard.region')">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <span class="text-[14px] font-[650] text-fg">{{ t("githubBoard.title") }}</span>
      <span class="rounded border border-amber px-1.5 text-[11px] text-amber">{{ t("githubBoard.experimental") }}</span>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="loading"
        :data-tip="t('githubBoard.refresh')"
        :aria-label="t('githubBoard.refresh')"
        @click="load"
      >
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
      <span v-if="loading" class="text-[12px] text-muted">{{ t("githubBoard.loading") }}</span>
      <label class="flex cursor-pointer items-center gap-1.5 text-[12px] text-secondary">
        <input type="checkbox" data-testid="board-open-work-only" :checked="boardOpenWorkOnly" @change="onOpenWorkOnlyChange" />
        {{ t("githubBoard.openWorkOnly") }}
      </label>
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          class="h-6 cursor-pointer rounded-md border border-border bg-base px-2 text-[12px] text-secondary hover:bg-hover hover:text-fg"
          @click="emit('list')"
        >
          {{ t("githubBoard.back") }}
        </button>
        <button
          type="button"
          class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary hover:bg-hover hover:text-fg"
          :data-tip="t('githubBoard.close')"
          :aria-label="t('githubBoard.close')"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </header>
    <!-- Its own row, as on /github: the non-Claude warning is a sentence and would crowd the header. -->
    <div data-testid="issue-start-agent-row" class="flex-none border-b border-border bg-panel px-4 py-1.5">
      <IssueStartAgentPicker />
    </div>
    <div class="flex min-h-0 min-w-0 flex-auto">
      <div class="min-w-0 flex-auto overflow-auto px-4 pb-16 pt-3">
        <p class="mb-3 text-[12px] text-muted">{{ t("githubBoard.rule") }}</p>
        <p v-if="startError" data-testid="issue-start-error" class="mb-3 text-[13px] text-err">{{ startError }}</p>
        <p v-if="failed" class="px-1 py-6 text-[13px] text-err">{{ t("githubBoard.loadFailed") }}</p>
        <p v-else-if="!loading && repos.length === 0" class="px-1 py-6 text-[13px] text-muted">{{ t("githubBoard.noRepos") }}</p>
        <p v-else-if="nothingOpen" data-testid="board-nothing-open" class="px-1 py-6 text-[13px] text-muted">
          {{ t("githubBoard.nothingOpen") }}
          <button type="button" class="ml-1 cursor-pointer text-accent underline" @click="setBoardOpenWorkOnly(false)">
            {{ t("githubBoard.showAll") }}
          </button>
        </p>
        <section v-for="repo in shownRepos" :key="repo.repo" data-testid="board-repo" class="mb-6">
          <h3 class="my-1.5 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">{{ repo.repo }}</h3>
          <p v-if="repo.error" class="px-1 py-3 text-[13px] text-err">{{ repo.error }}</p>
          <!-- Five tracks whatever is shown, so a column keeps its width when the switch drops the others. -->
          <div v-else class="grid min-w-[900px] grid-cols-5 gap-2.5">
            <div
              v-for="column in visibleColumns(repo, boardOpenWorkOnly)"
              :key="column"
              :data-testid="`board-column-${column}`"
              class="flex min-w-0 flex-col gap-1.5 rounded-md bg-base p-2"
            >
              <div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
                {{ t(`githubBoard.column.${column}`) }}
                <span class="font-normal">{{ cardsIn(repo, column).length }}</span>
              </div>
              <GithubBoardCard
                v-for="card in cardsIn(repo, column)"
                :key="card.key"
                :card="card"
                :home="home"
                :selected="isSelected(repo, card)"
                :repo="repo.repo"
                @select="select(repo, card)"
                @started="load"
              />
              <span v-if="cardsIn(repo, column).length === 0" class="text-[11px] text-dim">{{ t("githubBoard.empty") }}</span>
            </div>
          </div>
        </section>
      </div>
      <GithubBoardDetail v-if="selected" :repo="selected.repo" :card="selected.card" :home="home" @close="boardSelection = null" />
    </div>
  </div>
</template>
