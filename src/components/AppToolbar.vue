<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import { useRoute } from "vue-router";
import { router } from "../router";
import NotificationBell from "./NotificationBell.vue";
import RateLimitGauge from "./RateLimitGauge.vue";
import MachineLoadGauge from "./MachineLoadGauge.vue";
import { showLoadAverage } from "../composables/showLoadAverage";
import RemoteHostControl from "./RemoteHostControl.vue";
import LauncherButton from "./LauncherButton.vue";
import { CONTENT_ROUTES } from "../composables/overlayOrigin";
import { useCollectionBrowse, browseGotoIndex, browseGotoDetail } from "../composables/useCollectionBrowse";
import { useShortcuts } from "../composables/useShortcuts";
import { toolbarPinKeys } from "../composables/toolbarPins";
import { collectionChatCount } from "../composables/collectionChatSessions";
import { resolveToolbarPins, toolbarPinKey } from "../../common/toolbarPins";
import type { Shortcut } from "../../common/shortcuts";
import { filesGotoIndex } from "../composables/useFilesView";
import { useAccountingView, accountingViewOpen } from "../composables/useAccountingView";
import { useWikiBrowse, wikiGotoIndex, wikiGotoTag } from "../composables/useWikiBrowse";
import { useGithubView, githubGotoIndex } from "../composables/useGithubView";
import { useRoomsView, roomsViewOpen } from "../composables/useRoomsView";
import { useSoundEnabled } from "../composables/useSoundEnabled";
import { audioBlocked } from "../composables/audioUnlockState";
import { soundButtonState } from "./soundButtonState";
import { useUpdateStatus } from "../composables/useUpdateStatus";
import { useGithubStar } from "../composables/useGithubStar";
import { useDropdownMenu } from "../composables/useDropdownMenu";
import { parseTagQuery } from "./wikiTagFilter";
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
const { view: browseView } = useCollectionBrowse();
// The few favourites the user promoted out of the Collections overlay (#1984). Opening one used to
// take two presses — Collections, then the pinned row inside it — and the pins were invisible until
// the first of them. The label and the icon come from the PIN, never from the config that promoted
// it, so renaming a collection cannot leave a button here saying the old name.
const { shortcuts } = useShortcuts();
const pins = computed(() => resolveToolbarPins(shortcuts.value, toolbarPinKeys.value));
const pinActive = (pin: Shortcut): boolean => browseView.value.mode === "detail" && browseView.value.kind === pin.kind && browseView.value.slug === pin.slug;
const { isOpen: accountingOpen } = useAccountingView();
const { isOpen: wikiOpen } = useWikiBrowse();
const { isOpen: prsOpen } = useGithubView();
const { isOpen: roomsOpen } = useRoomsView();
const { enabled: soundEnabled, toggle: toggleSound } = useSoundEnabled();
const soundButton = computed(() => soundButtonState(soundEnabled.value, audioBlocked.value));
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
const onGridRoute = computed(() => route.name === "terminals");
// Lit on the DETAIL pages too, not just the index. A door that goes dark the moment you open one
// of the things behind it leaves the toolbar with nothing selected while you are plainly still
// inside that section — and since the grid's own controls hide under an overlay, nothing else
// would be lit either (Codex, PR #1201). The index/detail distinction belongs to the view, not to
// which section you are in.
const collectionsActive = computed(() => browseView.value.mode !== "closed" && browseView.value.kind === "collection");
// Chats running in the collection pane (#2001). They are not grid cells, so without this the only
// way to find out one is still there is to go and look. The count is on the button rather than in
// its own control because it is not a thing to press — it is a property of what is behind the door.
// The accessible name carries it too: a badge is `aria-hidden`, and a screen reader that only hears
// "Collections" is told less than the screen says.
const chatCount = computed(() => collectionChatCount());
const collectionsTitle = computed(() => {
  if (!chatCount.value) return "Collections";
  const chats = chatCount.value === 1 ? "1 chat" : `${chatCount.value} chats`;
  return `Collections — ${chats} running here`;
});
const feedsActive = computed(() => browseView.value.mode !== "closed" && browseView.value.kind === "feed");
const filesActive = computed(() => route.name === "files");
// Inside the content section — which is what reveals the siblings below. Answered from the ROUTE
// rather than from "is some overlay open", so moving between them (collections → wiki → files)
// never blinks the row that got you there.
const inContent = computed(() => CONTENT_ROUTES.has(String(route.name)));
const accountingActive = computed(() => accountingOpen.value);
const wikiActive = computed(() => wikiOpen.value);
const prsActive = computed(() => prsOpen.value);
const roomsActive = computed(() => roomsOpen.value);
function showGrid(): void {
  void router.push("/terminals");
}
function showCollections(): void {
  browseGotoIndex("collection");
}
function showAccounting(): void {
  accountingViewOpen();
}
function showFeeds(): void {
  browseGotoIndex("feed");
}
// No cwd: from here the Files view opens on the workspace, where a terminal header's Files button
// opens on that terminal's own directory. The route carries the difference (`?cwd=`).
function showFiles(): void {
  filesGotoIndex(null);
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
  githubGotoIndex();
}
// Beside PRs rather than behind the Collections door, for the same reason PRs is: a room is the
// record of what the terminals in the grid said to each other, not workspace content.
function showRooms(): void {
  roomsViewOpen();
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
        <LauncherButton icon="grid_view" title="Grid (multiple terminals)" label="Grid view" :active="onGridRoute" @click="showGrid" />
        <!-- The way IN to the workspace's own data, beside the views it is a peer of — the content
             surfaces used to be reachable only from the single view (#886), which left them with
             no door at all once that view goes. One button here rather than four: the rest appear
             below once you are inside, so the row a terminal user sees does not grow by four.
             Same `database` icon as the cell header's collections pane (CellChromeButtons.vue), so
             the door and the pane read as one thing wherever you meet them. -->
        <!-- The badge is how a chat running in the collection pane stays legible (#2001): it is not
             a grid cell, so nothing else on this screen says it exists. The door it lives behind
             wears the count, the way the bell wears its unread one. -->
        <span class="relative inline-flex flex-none">
          <LauncherButton icon="database" :title="collectionsTitle" :label="collectionsTitle" :active="collectionsActive" @click="showCollections" />
          <span
            v-if="chatCount"
            class="pointer-events-none absolute right-px top-px box-border h-[14px] min-w-[14px] rounded-[7px] bg-accent px-[3px] font-sans text-[9px] font-bold leading-[14px] text-on-accent"
            aria-hidden="true"
            >{{ chatCount > 99 ? "99+" : chatCount }}</span
          >
        </span>
      </span>
      <!-- The promoted favourites, right of the door they used to hide behind (#1984). They belong on
           THIS side of the fence and not with the buttons after it: pressing one leaves the view you
           are in, exactly as Grid and Collections do, where everything to the right acts within the
           current view. Their own rule, because they are the user's list rather than the app's pair.
           Nothing renders when none is promoted — the empty case has to leave the header, rule
           included, exactly as it was. -->
      <span
        v-if="pins.length"
        class="mr-1.5 inline-flex flex-none items-center gap-[3px] border-r border-border pr-2.5"
        role="group"
        aria-label="Pinned collections and feeds"
      >
        <LauncherButton
          v-for="pin in pins"
          :key="toolbarPinKey(pin)"
          :icon="pin.icon || 'bookmark'"
          :title="pin.title"
          :label="pin.title"
          :active="pinActive(pin)"
          @click="browseGotoDetail(pin.kind, pin.slug)"
        />
      </span>
      <!-- The other content surfaces, revealed by being IN the section rather than always present.
           Same reasoning as the fence above: everything here acts within the view you are in. -->
      <template v-if="inContent">
        <LauncherButton icon="rss_feed" title="Feeds" label="Feeds" :active="feedsActive" @click="showFeeds" />
        <LauncherButton icon="menu_book" title="Wiki" label="Wiki" :active="wikiActive" @click="showWiki" />
        <LauncherButton icon="account_balance" title="Accounting" label="Accounting" :active="accountingActive" @click="showAccounting" />
        <LauncherButton icon="folder_open" title="Files" label="Files" :active="filesActive" @click="showFiles" />
      </template>
      <!-- The grid's OWN controls, and only while the grid is on screen. They act on cells the user
           cannot see once a full-screen overlay covers them — a new terminal appearing behind the
           wiki, an ordering change nobody watches — and the rate gauge below is status for a view
           that is not showing. The switch group above never hides, so this never strands anyone:
           Grid view brings the terminals back and these with them.
           Work under supervision: PRs and the worklog sit with the terminals rather than behind the
           Collections door, which is why they are not in CONTENT_ROUTES. -->
      <template v-if="onGridRoute">
        <LauncherButton icon="call_merge" title="Pull requests" label="Pull requests" :active="prsActive" @click="showPrs" />
        <LauncherButton icon="forum" title="Rooms — round-table conversations" label="Rooms" :active="roomsActive" @click="showRooms" />
        <LauncherButton
          icon="history_edu"
          title="Worklog — the dev work log in the wiki (#worklog)"
          label="Worklog"
          :active="worklogActive"
          @click="showWorklog"
        />
        <LauncherButton
          icon="add"
          :title="addTerminalActive ? 'Close the launch panel' : 'Open the launch panel to start a terminal'"
          label="New terminal"
          :active="addTerminalActive"
          @click="emit('add-terminal')"
        />
        <LauncherButton :icon="sortButton.icon" :title="sortButton.title" :label="sortButton.label" :active="sortButton.active" @click="emit('toggle-sort')" />
      </template>
      <span
        v-if="hasSummary && statusCounts"
        class="ml-1.5 inline-flex flex-none items-center gap-2 border-l border-border pl-2.5"
        role="img"
        :aria-label="`Grid status — ${summaryTitle}`"
        :title="summaryTitle"
      >
        <span v-if="statusCounts.blocked" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-amber" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.blocked }}
        </span>
        <!-- Green like every other `done` mark (#1307), but --ok rather than --done: this tally is
             INK on the toolbar, and --done is a fill colour that reads at 2.3:1 on a white panel.
             --ok is the same pairing --warn/--amber already make for the blocked count. -->
        <span v-if="statusCounts.done" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-ok" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.done }}
        </span>
        <span v-if="statusCounts.working" class="inline-flex items-center gap-1 font-mono text-[12px] leading-none text-muted" aria-hidden="true">
          <span class="h-2 w-2 rounded-full bg-current" />{{ statusCounts.working }}
        </span>
      </span>
      <RateLimitGauge v-if="onGridRoute" />
      <MachineLoadGauge v-if="onGridRoute && showLoadAverage" />
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
    <LauncherButton v-if="starVisible" icon="star" :title="starTitle" :label="starTitle" :active="starConfirming" @click="activateStar" />
    <LauncherButton
      :icon="soundButton.icon"
      :title="soundButton.label"
      :label="soundButton.label"
      :active="soundButton.active"
      :tone="soundButton.tone"
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
