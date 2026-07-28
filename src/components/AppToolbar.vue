<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useRoute } from "vue-router";
import { router } from "../router";
import NotificationBell from "./NotificationBell.vue";
import RateLimitGauge from "./RateLimitGauge.vue";
import RemoteHostControl from "./RemoteHostControl.vue";
import LauncherButton from "./LauncherButton.vue";
import { useShortcuts } from "../composables/useShortcuts";
import { viewIsGrid } from "../composables/overlayOrigin";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useAccountingView, accountingViewOpen } from "../composables/useAccountingView";
import { useWikiBrowse, wikiGotoIndex, wikiGotoTag } from "../composables/useWikiBrowse";
import { usePrsView, prsGotoIndex } from "../composables/usePrsView";
import { useDecisionsView, decisionsGotoIndex } from "../composables/useDecisionsView";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import { useUpdateStatus } from "../composables/useUpdateStatus";
import { useGithubStar } from "../composables/useGithubStar";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import { parseTagQuery } from "./wikiTagFilter";
import type { Shortcut } from "../../common/shortcuts";
import type { SortMode, StatusCounts } from "./gridTabs";
import { gridStatusSummary } from "./gridTabs";
import { sortModeButton } from "./sortModeButton";

// The standard header, shared by the single (App.vue) and grid (GridView.vue) views so
// both show one identical toolbar. Every launcher button now just pushes a route — the
// surface (single shell vs grid, which overlay) is derived from the URL — so navigating
// to a single-view surface (collections / accounting) inherently leaves the grid. The
// active states re-derive from route.name (via the route-backed browse/accounting
// stores). Grid-only state (`addTerminalActive`, `sortMode`) is still passed in, and
// the grid-only actions (add-terminal / toggle-sort) and settings stay emits.
const props = defineProps<{
  addTerminalActive?: boolean;
  sortMode?: SortMode;
  statusCounts?: StatusCounts;
  // Grid zoom state, so the header can host the roster / strip toggle (shown only while zoomed).
  showViewToggle?: boolean;
  listMode?: boolean;
}>();
const emit = defineEmits<{ (e: "add-terminal" | "toggle-sort" | "toggle-view" | "settings"): void }>();
const sortButton = computed(() => sortModeButton(props.sortMode ?? "manual"));

const route = useRoute();
// Grid-wide, at-a-glance tally: how many cells are blocked (need input) / done
// (review) / working, across every page. Shown only when something is running.
const summary = computed(() => gridStatusSummary(props.statusCounts));
const summaryTitle = computed(() => summary.value.title);
const hasSummary = computed(() => summary.value.show);
const { shortcuts } = useShortcuts();
const { view: browseView } = useCollectionBrowse();
const { isOpen: accountingOpen } = useAccountingView();
const { isOpen: wikiOpen } = useWikiBrowse();
const { isOpen: prsOpen } = usePrsView();
const { isOpen: decisionsOpen } = useDecisionsView();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();
const { badge: updateBadge } = useUpdateStatus();
const { visible: starVisible, confirming: starConfirming, title: starTitle, activate: activateStar } = useGithubStar();

// Clicking the badge opens a popover that spells out what to run — a silent clipboard copy
// gave no hint of what happened or which command it even was.
const updateRoot = useTemplateRef<HTMLElement>("updateRoot");
const { open: updateOpen, toggle: toggleUpdate } = useDropdownMenu(updateRoot);
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

// Copy the command shown in the popover; a brief "Copied" confirms it. Clipboard can be
// unavailable (older browser, insecure context) — then it's a no-op and the command stays on
// screen to copy by hand.
async function copyUpdateCommand(): Promise<void> {
  const command = updateBadge.value?.command;
  if (!command) return;
  try {
    await navigator.clipboard.writeText(command);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied.value = false), 1500);
  } catch {
    // best-effort — the command is on screen to copy by hand
  }
}

// TWO different questions, and answering both with one flag is what broke #892.
//   - which buttons the header OFFERS: the view underneath, so an overlay opened from the
//     grid keeps the grid's buttons instead of hiding the one just clicked
//   - which button is HIGHLIGHTED, and whether the grid is the screen: the route itself,
//     because an open overlay is not the grid even when the grid is underneath
const inGrid = viewIsGrid;
const onGridRoute = computed(() => route.name === "terminals");
const inSingle = computed(() => !onGridRoute.value);
const chatActive = computed(() => inSingle.value && browseView.value.mode === "closed" && !accountingOpen.value && !wikiOpen.value && !prsOpen.value);
const collectionsActive = computed(() => browseView.value.mode === "index" && browseView.value.kind === "collection");
const accountingActive = computed(() => accountingOpen.value);
const wikiActive = computed(() => wikiOpen.value);
const prsActive = computed(() => prsOpen.value);
const decisionsActive = computed(() => decisionsOpen.value);
function favActive(s: Shortcut): boolean {
  return browseView.value.mode === "detail" && browseView.value.kind === s.kind && browseView.value.slug === s.slug;
}

function showChat(): void {
  router.push({ name: "chat" });
}
function showGrid(): void {
  router.push("/terminals");
}
function showCollections(): void {
  browseGotoIndex("collection");
}
function showFavorite(s: Shortcut): void {
  browseGotoDetail(s.kind, s.slug);
}
function showAccounting(): void {
  accountingViewOpen();
}
function showWiki(): void {
  wikiGotoIndex();
}
// Grid-only shortcut to the dev worklog: the wiki filtered to the #worklog tag (the weekly
// dev-log pages the scheduled worklog task writes).
const WORKLOG_TAG = "worklog";
const worklogActive = computed(() => wikiOpen.value && parseTagQuery(route.query.tag).has(WORKLOG_TAG));
function showWorklog(): void {
  wikiGotoTag(WORKLOG_TAG);
}
function showPrs(): void {
  prsGotoIndex();
}
// The decision log defaults to the server's workspace (the view resolves it) — the toolbar has no
// single directory to speak for, unlike a terminal header's button.
function showDecisions(): void {
  decisionsGotoIndex(null);
}
</script>

<template>
  <header class="flex h-10 flex-none items-center border-b border-border bg-panel px-4">
    <span class="font-sans text-[14px] font-semibold tracking-[0.02em] text-fg">MulmoTerminal</span>
    <nav class="ml-4 flex min-w-0 items-center gap-[3px] overflow-x-auto" aria-label="Views">
      <!-- Both views: the pair that switches between them. Fenced off with a rule because it is
           the only group here that changes WHICH VIEW you are in — everything to its right acts
           within the current one, and a flat row of equal buttons hid that (#941). Same rule
           treatment as the status tally at the other end of the nav. -->
      <span class="mr-1.5 inline-flex flex-none items-center gap-[3px] border-r border-border pr-2.5" role="group" aria-label="Switch view">
        <LauncherButton icon="chat" title="Chat" label="Chat" :active="chatActive" @click="showChat" />
        <LauncherButton icon="grid_view" title="Grid (multiple terminals)" label="Grid view" :active="onGridRoute" @click="showGrid" />
      </span>
      <!-- Single view only (#886): the content surfaces. The grid is for supervising agents,
           and every one of these replaces the whole screen anyway. -->
      <LauncherButton v-if="!inGrid" icon="apps" title="Collections" label="Collections" :active="collectionsActive" @click="showCollections" />
      <LauncherButton v-if="!inGrid" icon="account_balance" title="Accounting" label="Accounting" :active="accountingActive" @click="showAccounting" />
      <LauncherButton v-if="!inGrid" icon="menu_book" title="Wiki" label="Wiki" :active="wikiActive" @click="showWiki" />
      <!-- `template` wrapper rather than v-if on the v-for: the two directives on one element
           is a Vue anti-pattern (v-if wins and is evaluated per item). -->
      <template v-if="!inGrid">
        <LauncherButton
          v-for="s in shortcuts"
          :key="`${s.kind}:${s.slug}`"
          :icon="s.icon || 'bookmark'"
          :title="s.title"
          :label="s.title"
          :active="favActive(s)"
          @click="showFavorite(s)"
        />
      </template>
      <!-- Grid only (#886): branches under supervision are a grid concern. -->
      <LauncherButton v-if="inGrid" icon="call_merge" title="Pull requests" label="Pull requests" :active="prsActive" @click="showPrs" />
      <LauncherButton v-if="inGrid" icon="how_to_vote" title="Decisions" label="Decisions" :active="decisionsActive" @click="showDecisions" />
      <LauncherButton
        v-if="inGrid"
        icon="history_edu"
        title="Worklog — the dev work log in the wiki (#worklog)"
        label="Worklog"
        :active="worklogActive"
        @click="showWorklog"
      />
      <LauncherButton
        v-if="inGrid"
        icon="add"
        :title="addTerminalActive ? 'Cancel adding a terminal' : 'New terminal (overflows to a new tab when full)'"
        label="New terminal"
        :active="addTerminalActive"
        @click="emit('add-terminal')"
      />
      <LauncherButton
        v-if="inGrid"
        :icon="sortButton.icon"
        :title="sortButton.title"
        :label="sortButton.label"
        :active="sortButton.active"
        @click="emit('toggle-sort')"
      />
      <span
        v-if="inGrid && hasSummary && statusCounts"
        class="ml-1.5 inline-flex flex-none items-center gap-2 border-l border-border pl-2.5"
        role="img"
        :aria-label="`Grid status — ${summaryTitle}`"
        :title="summaryTitle"
      >
        <span v-if="statusCounts.blocked" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-amber" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.blocked }}
        </span>
        <span v-if="statusCounts.done" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-accent" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.done }}
        </span>
        <span v-if="statusCounts.working" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-muted" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.working }}
        </span>
      </span>
      <RateLimitGauge v-if="inGrid" />
    </nav>
    <NotificationBell class="ml-auto" />
    <RemoteHostControl />
    <div v-if="updateBadge" ref="updateRoot" class="relative mr-1 flex-none">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full border border-accent px-2 py-0.5 text-[12px] leading-none text-accent hover:bg-selected"
        :class="{ 'bg-selected': updateOpen }"
        :title="updateBadge.text"
        :aria-label="updateBadge.text"
        :aria-expanded="updateOpen"
        aria-haspopup="true"
        @click="toggleUpdate"
      >
        <span class="material-symbols-outlined text-[15px] leading-none" aria-hidden="true">upgrade</span>
        Update
      </button>
      <div
        v-if="updateOpen"
        class="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-border bg-panel p-3 text-[13px] text-fg shadow-lg"
        role="group"
        aria-label="Update available"
      >
        <p class="mb-2 font-semibold">A newer version is available</p>
        <template v-if="updateBadge.command">
          <p class="mb-1 text-muted">Run this to update:</p>
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 overflow-x-auto rounded bg-selected px-2 py-1 font-mono text-[12px] whitespace-nowrap">{{ updateBadge.command }}</code>
            <button type="button" class="flex-none rounded border border-border px-2 py-1 text-[12px] hover:bg-selected" @click="copyUpdateCommand">
              {{ copied ? "Copied" : "Copy" }}
            </button>
          </div>
        </template>
        <p v-else class="text-muted">{{ updateBadge.text }}</p>
      </div>
    </div>
    <!-- Grid only: star this project on GitHub. It retires itself once starred (or once the
         user has opened the repo page), so it is a one-time ask rather than a fixture. -->
    <LauncherButton v-if="inGrid && starVisible" icon="star" :title="starTitle" :label="starTitle" :active="starConfirming" @click="activateStar" />
    <LauncherButton
      :icon="soundEnabled ? 'notifications_active' : 'notifications_off'"
      :title="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :label="soundEnabled ? 'Attention sound on' : 'Attention sound off'"
      :active="soundEnabled"
      :aria-pressed="soundEnabled"
      @click="toggleSound"
    />
    <!-- Zoomed-grid only: switch the expanded terminal's side panel between the cockpit roster and
         the thumbnail strip. Sits at the right end (next to Settings) and hides when nothing is expanded. -->
    <LauncherButton
      v-if="showViewToggle"
      :icon="listMode ? 'view_carousel' : 'view_agenda'"
      :title="listMode ? 'Show thumbnail strip' : 'Show list roster'"
      :label="listMode ? 'Show thumbnail strip' : 'Show list roster'"
      @click="emit('toggle-view')"
    />
    <LauncherButton icon="settings" title="Settings" label="Settings" @click="emit('settings')" />
  </header>
</template>
