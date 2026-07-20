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

useEscapeToClose(isOpen, close);
</script>

<template>
  <div v-if="isOpen" class="fixed inset-x-0 top-10 bottom-0 z-50 bg-deep flex flex-col" role="region" aria-label="Pull requests and issues">
    <header class="prs-head">
      <span class="prs-title">PRs &amp; Issues</span>
      <button type="button" class="prs-reload" :disabled="loading" title="Reload" aria-label="Reload PR and issue list" @click="load">↻</button>
      <span v-if="loading" class="prs-status">Loading…</span>
    </header>
    <div class="prs-content">
      <p v-if="!loading && !prsError && !issuesError && repos.length === 0 && issueRepos.length === 0" class="prs-msg">
        No repositories configured. Add <code>owner/repo</code> entries under Settings (⚙) → Pull request repos.
      </p>
      <template v-else>
        <h2 class="prs-section">Pull requests</h2>
        <p v-if="prsError" class="prs-msg prs-error">{{ prsError }}</p>
        <section v-for="r in repos" :key="`pr-${r.repo}`" class="prs-repo">
          <h3 class="prs-repo-name">
            {{ r.repo }}
            <span v-if="r.prs" class="prs-count">{{ r.prs.length }}</span>
          </h3>
          <p v-if="r.error" class="prs-msg prs-error">{{ r.error }}</p>
          <p v-else-if="r.prs && r.prs.length === 0" class="prs-msg prs-empty">No open PRs</p>
          <ul v-else-if="r.prs" class="prs-list">
            <li v-for="pr in r.prs" :key="pr.number">
              <a class="prs-row" :href="pr.url" target="_blank" rel="noopener noreferrer">
                <span class="prs-ci" :class="`ci-${pr.ci}`" role="img" :aria-label="CI_TITLE[pr.ci]" :title="CI_TITLE[pr.ci]" />
                <span class="prs-num">#{{ pr.number }}</span>
                <span class="prs-name">{{ pr.title }}</span>
                <span v-if="pr.isDraft" class="prs-tag prs-draft">draft</span>
                <span v-if="pr.review" class="prs-tag" :class="`rev-${pr.review}`">{{ REVIEW_LABEL[pr.review] ?? pr.review.toLowerCase() }}</span>
                <span class="prs-meta">{{ pr.author }} · {{ relativeTime(pr.updatedAt) }}</span>
              </a>
            </li>
          </ul>
          <p v-if="r.truncated" class="prs-msg prs-empty">Showing the first {{ r.prs?.length ?? 0 }} — this repo has more open PRs.</p>
        </section>

        <h2 class="prs-section">Issues</h2>
        <p v-if="issuesError" class="prs-msg prs-error">{{ issuesError }}</p>
        <section v-for="r in issueRepos" :key="`iss-${r.repo}`" class="prs-repo">
          <h3 class="prs-repo-name">
            {{ r.repo }}
            <span v-if="r.issues" class="prs-count">{{ r.issues.length }}</span>
          </h3>
          <p v-if="r.error" class="prs-msg prs-error">{{ r.error }}</p>
          <p v-else-if="r.issues && r.issues.length === 0" class="prs-msg prs-empty">No open issues</p>
          <ul v-else-if="r.issues" class="prs-list">
            <li v-for="iss in r.issues" :key="iss.number">
              <a class="prs-row" :href="iss.url" target="_blank" rel="noopener noreferrer">
                <span class="prs-num">#{{ iss.number }}</span>
                <span class="prs-name">{{ iss.title }}</span>
                <span class="prs-meta">{{ iss.author }} · {{ relativeTime(iss.updatedAt) }}</span>
              </a>
            </li>
          </ul>
          <p v-if="r.truncated" class="prs-msg prs-empty">
            Showing the latest {{ r.issues?.length ?? 0 }} —
            <a :href="r.url" target="_blank" rel="noopener noreferrer" class="prs-link">see all open issues on GitHub</a>.
          </p>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.prs-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}
.prs-title {
  font-weight: 650;
  font-size: 14px;
  color: var(--text);
}
.prs-reload {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  width: 26px;
  height: 24px;
  font-size: 14px;
}
.prs-reload:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.prs-reload:disabled {
  opacity: 0.5;
  cursor: default;
}
.prs-status {
  font-size: 12px;
  color: var(--text-muted);
}
.prs-content {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 12px 16px 64px;
}
.prs-msg {
  padding: 24px 4px;
  color: var(--text-muted);
  font-size: 13px;
}
.prs-error {
  color: var(--err);
}
.prs-empty {
  padding: 8px 4px;
}
.prs-section {
  margin: 4px 0 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.prs-section:not(:first-child) {
  margin-top: 28px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.prs-link {
  color: var(--accent, #3b82f6);
  text-decoration: underline;
}
.prs-repo {
  margin-bottom: 20px;
}
.prs-repo-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin: 6px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.prs-count {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}
.prs-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.prs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  color: var(--text-secondary);
  text-decoration: none;
  cursor: pointer;
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
}
.prs-row:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.prs-ci {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--text-dim);
}
.ci-passing {
  background: #3fae6b;
}
.ci-failing {
  background: var(--err-text, #e0556b);
}
.ci-pending {
  background: var(--amber, #e0a030);
}
.prs-num {
  flex: 0 0 auto;
  font-family: ui-monospace, monospace;
  color: var(--text-dim);
}
.prs-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.prs-tag {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.prs-draft {
  color: var(--text-dim);
}
.rev-APPROVED {
  color: #3fae6b;
  border-color: #3fae6b;
}
.rev-CHANGES_REQUESTED {
  color: var(--err-text, #e0556b);
  border-color: var(--err-text, #e0556b);
}
.prs-meta {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
