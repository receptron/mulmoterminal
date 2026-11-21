<script setup lang="ts">
// One repository's open pull requests, under the repo's name — each beside the conversation that made
// it, when the Library knows one (#3330).
import { ref, watch } from "vue";
import type { CiState, RepoPrs } from "../../common/ghItems";
import type { LibraryConversation } from "../../common/library";
import { githubRepoName } from "../../common/repoEntry";
import { loadPrCreators } from "../composables/libraryApi";
import { libraryViewOpen } from "../composables/useLibraryView";
import { relativeTimeFromIso } from "./cellDisplay";
import { ciDotClass } from "./ciDot";
import GithubUnregisteredTag from "./GithubUnregisteredTag.vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{ repo: RepoPrs }>();

// Nothing to show rather than an error when the lookup fails: the PR list is this view's job.
const creators = ref(new Map<number, LibraryConversation>());
let lookups = 0;
watch(
  () => [props.repo.repo, (props.repo.prs ?? []).map((pr) => pr.number).join(",")] as const,
  async ([repository]) => {
    const mine = ++lookups;
    creators.value = new Map(); // never another repository's buttons while this one is asked
    const numbers = (props.repo.prs ?? []).map((pr) => pr.number);
    // GitHub only, by its `owner/repo`: pr-link records are GitHub's, whichever way the entry spells it.
    const name = githubRepoName(repository);
    if (name === null || numbers.length === 0) return;
    const found = await loadPrCreators(name, numbers);
    if (mine === lookups) creators.value = new Map((found ?? []).map((creator) => [creator.number, creator.conversation]));
  },
  { immediate: true },
);

function openCreator(number: number): void {
  const conversation = creators.value.get(number);
  if (conversation) libraryViewOpen({ session: conversation.id, cwd: conversation.cwd });
}

const CI_TITLE_KEY: Record<CiState, string> = {
  passing: "tips.overlays.ci.passing",
  failing: "tips.overlays.ci.failing",
  pending: "tips.overlays.ci.pending",
  none: "tips.overlays.ci.none",
};
const REVIEW_LABEL: Record<string, string> = { APPROVED: "approved", CHANGES_REQUESTED: "changes requested", REVIEW_REQUIRED: "review required" };

// Review-tag colour: approved green, changes-requested red; anything else keeps
// the neutral tag colours. Returns text + border together so there's no cascade race.
function reviewTagClass(review: string): string {
  if (review === "APPROVED") return "border-[#3fae6b] text-[#3fae6b]";
  if (review === "CHANGES_REQUESTED") return "border-err-text text-err-text";
  return "border-border text-muted";
}
</script>

<template>
  <section class="mb-5">
    <h3 class="my-1.5 flex items-center gap-2 border-b border-border pb-1 font-mono text-[13px] font-semibold text-fg">
      {{ repo.repo }}
      <GithubUnregisteredTag v-if="repo.unregistered" data-testid="prs-repo-unregistered" />
      <span v-if="repo.prs" class="text-[11px] font-normal text-muted">{{ repo.prs.length }}</span>
    </h3>
    <p v-if="repo.error" class="px-1 py-6 text-[13px] text-err">{{ repo.error }}</p>
    <p v-else-if="repo.prs && repo.prs.length === 0" class="px-1 py-2 text-[13px] text-muted">No open PRs</p>
    <ul v-else-if="repo.prs" class="m-0 list-none p-0">
      <li v-for="pr in repo.prs" :key="pr.number" class="flex items-center gap-1">
        <a
          data-testid="prs-row"
          class="flex min-w-0 flex-auto cursor-pointer items-center gap-2.5 rounded-md px-2 py-[7px] text-left text-[13px] text-secondary no-underline hover:bg-hover hover:text-fg"
          :href="pr.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span
            class="h-[9px] w-[9px] flex-none rounded-full"
            :class="ciDotClass(pr.ci)"
            role="img"
            :aria-label="t(CI_TITLE_KEY[pr.ci])"
            :data-tip="t(CI_TITLE_KEY[pr.ci])"
          />
          <span class="flex-none font-[ui-monospace,monospace] text-dim">#{{ pr.number }}</span>
          <span class="min-w-0 flex-auto truncate">{{ pr.title }}</span>
          <span v-if="pr.isDraft" class="flex-none rounded-[10px] border border-border px-1.5 py-px text-[11px] text-dim">draft</span>
          <span v-if="pr.review" class="flex-none rounded-[10px] border px-1.5 py-px text-[11px]" :class="reviewTagClass(pr.review)">{{
            REVIEW_LABEL[pr.review] ?? pr.review.toLowerCase()
          }}</span>
          <span class="flex-none text-[11px] text-dim">{{ pr.author }} · {{ relativeTimeFromIso(pr.updatedAt, Date.now()) }}</span>
        </a>
        <!-- Beside the row, not in it: the row is a link out to GitHub, and a button cannot sit inside one. -->
        <button
          v-if="creators.has(pr.number)"
          type="button"
          data-testid="prs-open-conversation"
          class="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-dim hover:bg-hover hover:text-fg"
          :aria-label="t('libraryView.openPrConversation', { number: pr.number })"
          :data-tip="t('libraryView.openPrConversation', { number: pr.number })"
          @click="openCreator(pr.number)"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">local_library</span>
        </button>
      </li>
    </ul>
    <p v-if="repo.truncated" class="px-1 py-2 text-[13px] text-muted">Showing the first {{ repo.prs?.length ?? 0 }} — this repo has more open PRs.</p>
  </section>
</template>
