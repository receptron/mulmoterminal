<script setup lang="ts">
// Full-screen cross-repo PR + issue list, a sibling of WikiBrowseOverlay /
// AccountingOverlay. Driven by usePrsView (the /prs route). Fetches /api/prs and
// /api/issues (the repos set in Settings, aggregated server-side via `gh`) on open and
// on the reload button, grouped by repo. Read-only: a row click opens it on GitHub.
import { ref, watch } from "vue";
import { usePrsView } from "../composables/usePrsView";
import { useEscapeToClose } from "../composables/useEscapeToClose";

type CiState = "passing" | "failing" | "pending" | "none";
interface PrItem {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  isDraft: boolean;
  url: string;
  review: string | null;
  ci: CiState;
}
interface RepoPrs {
  repo: string;
  prs?: PrItem[];
  error?: string;
  truncated?: boolean;
}
interface IssueItem {
  number: number;
  title: string;
  author: string;
  updatedAt: string;
  url: string;
}
interface RepoIssues {
  repo: string;
  issues?: IssueItem[];
  error?: string;
  truncated?: boolean;
  url?: string;
}

const { isOpen, close } = usePrsView();

const repos = ref<RepoPrs[]>([]);
const issueRepos = ref<RepoIssues[]>([]);
const loading = ref(false);
const prsError = ref<string | null>(null);
const issuesError = ref<string | null>(null);
let reqId = 0;

// Each section loads independently so one endpoint failing (e.g. a transient
// /api/issues error) never blanks the other — the PR dashboard keeps rendering.
async function loadSection(path: string): Promise<{ rows: unknown[]; error: string | null }> {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { rows: Array.isArray(data.repos) ? data.repos : [], error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

async function load(): Promise<void> {
  const id = ++reqId;
  loading.value = true;
  prsError.value = null;
  issuesError.value = null;
  const [prs, issues] = await Promise.all([loadSection("/api/prs"), loadSection("/api/issues")]);
  if (id !== reqId) return;
  repos.value = prs.rows as RepoPrs[];
  prsError.value = prs.error;
  issueRepos.value = issues.rows as RepoIssues[];
  issuesError.value = issues.error;
  loading.value = false;
}

// Re-fetch each time the view is entered (open PRs change as work lands elsewhere).
watch(isOpen, (open) => open && load(), { immediate: true });

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}
const CI_TITLE: Record<CiState, string> = { passing: "Checks passing", failing: "Checks failing", pending: "Checks running", none: "No checks" };
const REVIEW_LABEL: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

// CI dot colour: passing green (hardcoded, token-less), failing/pending on the
// theme err/amber tokens, no-checks the dim default.
function ciDotClass(ci: CiState): string {
  if (ci === "passing") return "bg-[#3fae6b]";
  if (ci === "failing") return "bg-err-text";
  if (ci === "pending") return "bg-amber";
  return "bg-dim";
}
// Review-tag colour: approved green, changes-requested red; anything else keeps
// the neutral tag colours. Returns text + border together so there's no cascade race.
function reviewTagClass(review: string): string {
  if (review === "APPROVED") return "border-[#3fae6b] text-[#3fae6b]";
  if (review === "CHANGES_REQUESTED") return "border-err-text text-err-text";
  return "border-border text-muted";
}

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Pull requests and issues">
    <header class="flex flex-none items-center gap-2.5 border-b border-border bg-panel px-4 py-2">
      <span class="text-[14px] font-[650] text-fg">PRs &amp; Issues</span>
      <button
        type="button"
        class="h-6 w-[26px] cursor-pointer rounded-md border border-border bg-base text-[14px] text-secondary enabled:hover:bg-hover enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
        :disabled="loading"
        title="Reload"
        aria-label="Reload PR and issue list"
        @click="load"
      >
        ↻
      </button>
      <span v-if="loading" class="text-[12px] text-muted">Loading…</span>
    </header>
    <div class="flex-auto overflow-y-auto px-4 pb-16 pt-3">
      <p v-if="!loading && !prsError && !issuesError && repos.length === 0 && issueRepos.length === 0" class="px-1 py-6 text-[13px] text-muted">
        No repositories configured. Add <code>owner/repo</code> entries under Settings (⚙) → Pull request repos.
      </p>
      <template v-else>
        <h2
          class="mb-3 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted [&:not(:first-child)]:mt-7 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4"
        >
          Pull requests
        </h2>
        <p v-if="prsError" class="px-1 py-6 text-[13px] text-err">{{ prsError }}</p>
        <section v-for="r in repos" :key="`pr-${r.repo}`" class="mb-5">
          <h3 class="my-1.5 flex items-center gap-2 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">
            {{ r.repo }}
            <span v-if="r.prs" class="text-[11px] font-normal text-muted">{{ r.prs.length }}</span>
          </h3>
          <p v-if="r.error" class="px-1 py-6 text-[13px] text-err">{{ r.error }}</p>
          <p v-else-if="r.prs && r.prs.length === 0" class="px-1 py-2 text-[13px] text-muted">No open PRs</p>
          <ul v-else-if="r.prs" class="m-0 list-none p-0">
            <li v-for="pr in r.prs" :key="pr.number">
              <a
                data-testid="prs-row"
                class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] text-secondary no-underline hover:bg-hover hover:text-fg"
                :href="pr.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span
                  class="h-[9px] w-[9px] flex-none rounded-full"
                  :class="ciDotClass(pr.ci)"
                  role="img"
                  :aria-label="CI_TITLE[pr.ci]"
                  :title="CI_TITLE[pr.ci]"
                />
                <span class="flex-none font-[ui-monospace,monospace] text-dim">#{{ pr.number }}</span>
                <span class="min-w-0 flex-auto truncate">{{ pr.title }}</span>
                <span v-if="pr.isDraft" class="flex-none rounded-[10px] border border-border px-1.5 py-px text-[11px] text-dim">draft</span>
                <span v-if="pr.review" class="flex-none rounded-[10px] border px-1.5 py-px text-[11px]" :class="reviewTagClass(pr.review)">{{
                  REVIEW_LABEL[pr.review] ?? pr.review.toLowerCase()
                }}</span>
                <span class="flex-none text-[11px] text-dim">{{ pr.author }} · {{ relativeTime(pr.updatedAt) }}</span>
              </a>
            </li>
          </ul>
          <p v-if="r.truncated" class="px-1 py-2 text-[13px] text-muted">Showing the first {{ r.prs?.length ?? 0 }} — this repo has more open PRs.</p>
        </section>

        <h2
          class="mb-3 mt-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted [&:not(:first-child)]:mt-7 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-4"
        >
          Issues
        </h2>
        <p v-if="issuesError" class="px-1 py-6 text-[13px] text-err">{{ issuesError }}</p>
        <section v-for="r in issueRepos" :key="`iss-${r.repo}`" class="mb-5">
          <h3 class="my-1.5 flex items-center gap-2 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">
            {{ r.repo }}
            <span v-if="r.issues" class="text-[11px] font-normal text-muted">{{ r.issues.length }}</span>
          </h3>
          <p v-if="r.error" class="px-1 py-6 text-[13px] text-err">{{ r.error }}</p>
          <p v-else-if="r.issues && r.issues.length === 0" class="px-1 py-2 text-[13px] text-muted">No open issues</p>
          <ul v-else-if="r.issues" class="m-0 list-none p-0">
            <li v-for="iss in r.issues" :key="iss.number">
              <a
                data-testid="prs-row"
                class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] text-secondary no-underline hover:bg-hover hover:text-fg"
                :href="iss.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="flex-none font-[ui-monospace,monospace] text-dim">#{{ iss.number }}</span>
                <span class="min-w-0 flex-auto truncate">{{ iss.title }}</span>
                <span class="flex-none text-[11px] text-dim">{{ iss.author }} · {{ relativeTime(iss.updatedAt) }}</span>
              </a>
            </li>
          </ul>
          <p v-if="r.truncated" class="px-1 py-2 text-[13px] text-muted">
            Showing the latest {{ r.issues?.length ?? 0 }} —
            <a :href="r.url" target="_blank" rel="noopener noreferrer" data-testid="prs-link" class="text-accent underline">see all open issues on GitHub</a>.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>
