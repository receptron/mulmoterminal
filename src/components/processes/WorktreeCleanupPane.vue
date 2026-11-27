<script setup lang="ts">
// Managed worktrees of the folders terminals have run in, each with what keeps it from being
// removed (#2219). Read once when shown and on Refresh — it is a few git calls per worktree.
// Removing is a button per candidate; nothing is removed automatically.
import { computed, onMounted, ref, shallowRef } from "vue";
import { onOverlayShownAgain } from "../../composables/overlayVisibility";
import { useI18n } from "vue-i18n";
import { loadWorktreeCleanup, removeCleanupWorktree } from "../../composables/processesApi";
import { cleanupBlockers, isCleanupCandidate, type WorktreeCleanupRow } from "../../../common/worktreeCleanup";

const { t } = useI18n();

const rows = shallowRef<WorktreeCleanupRow[] | null>(null);
const loadFailed = ref(false);
const onlyCandidates = ref(false);
const removing = ref<string | null>(null);
const removeError = ref<string | null>(null);

const shownRows = computed(() => (rows.value ?? []).filter((row) => !onlyCandidates.value || isCleanupCandidate(row)));

// Refresh, then Remove, starts two reads that can finish in either order; only the latest one may
// set the list, or a slow earlier read shows a worktree that was just removed.
let latestRead = 0;

async function refresh(): Promise<void> {
  const thisRead = ++latestRead;
  loadFailed.value = false;
  const read = await loadWorktreeCleanup();
  if (thisRead !== latestRead) return;
  loadFailed.value = read === null;
  // A failed re-read keeps the list shown, under the failure, rather than taking it away.
  if (read !== null || rows.value === null) rows.value = read;
}

const ignoredNames = (row: WorktreeCleanupRow): string =>
  [
    ...row.ignored,
    ...(row.ignoredCount > row.ignored.length ? [t("processesView.worktrees.ignoredMore", { count: row.ignoredCount - row.ignored.length })] : []),
  ].join(", ");

function removeConfirmText(row: WorktreeCleanupRow): string {
  const ask = t("processesView.worktrees.removeConfirm", { path: row.path, base: row.base });
  return row.ignoredCount === 0 ? ask : `${ask}\n\n${t("processesView.worktrees.removeConfirmIgnored", { names: ignoredNames(row) })}`;
}

async function remove(row: WorktreeCleanupRow): Promise<void> {
  if (removing.value !== null) return;
  if (!window.confirm(removeConfirmText(row))) return;
  removing.value = row.path;
  removeError.value = null;
  const ok = await removeCleanupWorktree(row);
  removing.value = null;
  if (!ok) removeError.value = t("processesView.worktrees.removeFailed", { path: row.path });
  await refresh();
}

onMounted(() => void refresh());
onOverlayShownAgain(() => void refresh());
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto p-4">
    <p class="m-0 mb-2 font-sans text-[12px] text-secondary">{{ t("processesView.worktrees.intro") }}</p>
    <div class="mb-3 flex items-center gap-3">
      <label class="flex items-center gap-1.5 font-sans text-[12px] text-secondary">
        <input v-model="onlyCandidates" type="checkbox" data-testid="worktrees-only-candidates" />
        {{ t("processesView.worktrees.onlyCandidates") }}
      </label>
      <button
        type="button"
        data-testid="worktrees-refresh"
        class="cursor-pointer rounded-[4px] border border-border bg-transparent px-2 py-0.5 font-sans text-[11px] text-secondary hover:bg-hover hover:text-fg"
        @click="refresh"
      >
        {{ t("processesView.refresh") }}
      </button>
    </div>
    <p v-if="removeError" data-testid="worktrees-remove-error" class="m-0 mb-3 font-sans text-[13px] text-err-text">{{ removeError }}</p>
    <!-- Its own line, not the head of the chain below: a list kept through a failed re-read shows under it. -->
    <p v-if="loadFailed" class="m-0 font-sans text-[13px] text-err-text">{{ t("processesView.worktrees.loadFailed") }}</p>
    <template v-if="!rows">
      <p v-if="!loadFailed" class="m-0 font-sans text-[13px] text-dim">{{ t("processesView.worktrees.loading") }}</p>
    </template>
    <p v-else-if="!rows.length" class="m-0 font-sans text-[13px] text-dim">{{ t("processesView.worktrees.empty") }}</p>
    <p v-else-if="!shownRows.length" class="m-0 font-sans text-[13px] text-dim">{{ t("processesView.worktrees.noCandidates") }}</p>
    <ul v-else class="m-0 list-none p-0">
      <li v-for="row in shownRows" :key="row.path" data-testid="worktrees-row" class="flex items-center gap-3 border-t border-border py-2">
        <div class="min-w-0 flex-1">
          <p class="m-0 truncate font-mono text-[12px] text-fg" :data-tip="row.path">{{ row.path }}</p>
          <p class="m-0 flex flex-wrap items-baseline gap-x-3 font-sans text-[11px] text-dim">
            <span class="font-mono">{{ row.branch ?? t("processesView.worktrees.detached") }}</span>
            <span>{{ t("processesView.worktrees.base", { base: row.base }) }}</span>
            <span v-if="isCleanupCandidate(row)" class="text-ok">{{ t("processesView.worktrees.candidate") }}</span>
            <span v-if="row.ignoredCount > 0" data-testid="worktrees-ignored" class="text-secondary" :data-tip="ignoredNames(row)">{{
              t("processesView.worktrees.ignored", { names: ignoredNames(row) })
            }}</span>
            <span v-for="blocker in cleanupBlockers(row)" :key="blocker" data-testid="worktrees-blocker" class="text-warn">{{
              t(`processesView.worktrees.blocker.${blocker}`)
            }}</span>
          </p>
        </div>
        <button
          v-if="isCleanupCandidate(row)"
          type="button"
          data-testid="worktrees-remove"
          class="flex-none cursor-pointer rounded-[4px] border border-border bg-transparent px-2 py-0.5 font-sans text-[11px] text-secondary hover:bg-[var(--err-hover-bg)] hover:text-err-text disabled:cursor-default disabled:opacity-50"
          :disabled="removing !== null"
          @click="remove(row)"
        >
          {{ t("processesView.worktrees.remove") }}
        </button>
      </li>
    </ul>
  </div>
</template>
