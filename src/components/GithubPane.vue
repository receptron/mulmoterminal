<script setup lang="ts">
// The cross-repo PR + issue list itself — the whole GitHub view except the frame GithubOverlay
// mounts it in.
//
// Fetches /api/prs and /api/issues (the repos set in Settings, aggregated server-side via `gh`)
// when it mounts and on the reload button, grouped by repo. Read-only apart from IssueStartButton:
// a row click opens it on GitHub.
import { ref, onMounted } from "vue";
import type { RepoIssues, RepoPrs } from "../../common/ghItems";
import { useIssueStart } from "../composables/useIssueStart";
import { githubBoardGoto } from "../composables/useGithubBoardView";
import GithubPrRepo from "./GithubPrRepo.vue";
import GithubIssueRepo from "./GithubIssueRepo.vue";
import IssueStartAgentPicker from "./IssueStartAgentPicker.vue";
import GithubLoading from "./GithubLoading.vue";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const emit = defineEmits<{ (e: "close"): void }>();

const { loadRepoDirs, startError } = useIssueStart();

const repos = ref<RepoPrs[]>([]);
const issueRepos = ref<RepoIssues[]>([]);
const loading = ref(false);
const loaded = ref(false);
const prsError = ref<string | null>(null);
const issuesError = ref<string | null>(null);
let reqId = 0;

// Each section loads independently so one endpoint failing (e.g. a transient
// /api/issues error) never blanks the other — the PR dashboard keeps rendering.
// The two row shapes as they arrive from /api/prs and /api/issues. Only `repo` is required to
// place a row; everything else the templates read is optional there too.
const isRepoPrs = (row: unknown): row is RepoPrs => isRecord(row) && typeof row.repo === "string";
const isRepoIssues = (row: unknown): row is RepoIssues => isRecord(row) && typeof row.repo === "string";

async function loadSection(path: string): Promise<{ rows: unknown[]; error: string | null }> {
  try {
    const res = await fetchWithTimeout(path, undefined, SLOW_COMMAND_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await jsonBody(res);
    return { rows: isUnknownArray(data.repos) ? data.repos : [], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function load(): Promise<void> {
  const id = ++reqId;
  loading.value = true;
  prsError.value = null;
  issuesError.value = null;
  // Alongside the two lists: the issue rows need to know which repos have a clone here before
  // their start control can say anything, and it is the same one-shot read on view open.
  const [prs, issues] = await Promise.all([loadSection("/api/prs"), loadSection("/api/issues"), loadRepoDirs()]);
  if (id !== reqId) return;
  repos.value = prs.rows.filter(isRepoPrs);
  prsError.value = prs.error;
  issueRepos.value = issues.rows.filter(isRepoIssues);
  issuesError.value = issues.error;
  loading.value = false;
  loaded.value = true;
}

// On mount rather than on a route change: the overlay mounts this fresh with `v-if` when it opens,
// so mounting IS being entered — and open PRs change as work lands elsewhere, so a stale list is
// worth one fetch.
onMounted(() => void load());
</script>

<template>
  <!-- `truncate` on the rows only works with an unbroken min-w-0 chain above it, which is why the
       scroller carries it too. -->
  <div class="flex h-full min-h-0 min-w-0 flex-col bg-deep" role="region" :aria-label="t('tips.overlays.githubRegion')">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <slot name="title"><span class="text-[14px] font-[650] text-fg">GitHub</span></slot>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="loading"
        :data-tip="t('tips.overlays.reload')"
        :aria-label="t('tips.overlays.reloadGithub')"
        :aria-busy="loading"
        data-testid="github-refresh"
        @click="load"
      >
        <span class="material-symbols-outlined" :class="{ 'animate-spin': loading }" aria-hidden="true">refresh</span>
      </button>
      <div class="ml-auto flex items-center gap-1">
        <button
          type="button"
          data-testid="github-open-board"
          class="h-6 cursor-pointer rounded-md border border-border bg-base px-2 text-[12px] text-secondary hover:bg-hover hover:text-fg"
          @click="githubBoardGoto"
        >
          {{ t("githubBoard.open") }}
        </button>
        <button
          type="button"
          class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary hover:bg-hover hover:text-fg"
          :data-tip="t('tips.overlays.close')"
          :aria-label="t('tips.overlays.closeGithub')"
          @click="emit('close')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
    </header>
    <!-- Its own row, not the header: the non-Claude warning is a sentence, and on a narrow window it
         would push Reload and Close off the header. Only where there are issues to start. -->
    <div v-if="issueRepos.length" data-testid="issue-start-agent-row" class="flex-none border-b border-border bg-panel px-4 py-1.5">
      <IssueStartAgentPicker />
    </div>
    <div class="min-w-0 flex-auto overflow-y-auto px-4 pb-16 pt-3">
      <GithubLoading v-if="!loaded" />
      <p v-else-if="!loading && !prsError && !issuesError && repos.length === 0 && issueRepos.length === 0" class="px-1 py-6 text-[13px] text-muted">
        No repositories configured. Add <code>owner/repo</code> entries under Settings → Pull request repos.
      </p>
      <template v-else>
        <h2
          v-if="repos.length > 0 || prsError"
          class="mb-3 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted [&:not(:first-child)]:mt-7 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4"
        >
          Pull requests
        </h2>
        <p v-if="prsError" class="px-1 py-6 text-[13px] text-err">{{ prsError }}</p>
        <GithubPrRepo v-for="r in repos" :key="`pr-${r.repo}`" :repo="r" />

        <h2
          v-if="issueRepos.length > 0 || issuesError"
          class="mb-3 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted [&:not(:first-child)]:mt-7 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4"
        >
          Issues
        </h2>
        <p v-if="issuesError" class="px-1 py-6 text-[13px] text-err">{{ issuesError }}</p>
        <!-- One place for the whole section: only one start can be in flight at a time, so a
             per-repo copy would be the same message repeated down the page. -->
        <p v-if="startError" data-testid="issue-start-error" class="px-1 py-2 text-[13px] text-err">{{ startError }}</p>
        <GithubIssueRepo v-for="r in issueRepos" :key="`iss-${r.repo}`" :repo="r" />
      </template>
    </div>
  </div>
</template>
