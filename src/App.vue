<script setup lang="ts">
// The application shell, and by now almost nothing: the grid IS the app, and the full-screen
// overlays render on top of it. What is left here is the handful of concerns that belong to the
// PAGE rather than to any view — a launch request arriving from the phone, the attention sound,
// the favicon, the close guard.
//
// The single terminal view lived here until #1202. Everything it owned has a home in the grid: the
// settings modal (GridView's own), the tools and Canvas panes (the grid's right pane), the session
// list (the cockpit roster, and the launcher's resume list for sessions off the grid), and the
// content surfaces (the Collections door in the toolbar). What it uniquely had — one terminal
// filling the window — is a zoomed cell.
import { computed, onUnmounted } from "vue";
import CollectionsBrowseOverlay from "./components/CollectionsBrowseOverlay.vue";
import AccountingOverlay from "./components/AccountingOverlay.vue";
import WikiBrowseOverlay from "./components/WikiBrowseOverlay.vue";
import GithubOverlay from "./components/GithubOverlay.vue";
import GithubBoardOverlay from "./components/GithubBoardOverlay.vue";
import RoomsOverlay from "./components/RoomsOverlay.vue";
import BlueprintsOverlay from "./components/blueprints/BlueprintsOverlay.vue";
import SkillsOverlay from "./components/SkillsOverlay.vue";
import ProcessesOverlay from "./components/processes/ProcessesOverlay.vue";
import UsageOverlay from "./components/usage/UsageOverlay.vue";
import FilesOverlay from "./components/FilesOverlay.vue";
import ConfettiOverlay from "./components/ConfettiOverlay.vue";
import TerminalLinkMenu from "./components/TerminalLinkMenu.vue";
import HoverTip from "./components/HoverTip.vue";
import ServerStoppedOverlay from "./components/ServerStoppedOverlay.vue";
import WhatsNewDialog from "./components/WhatsNewDialog.vue";
import GridView from "./components/GridView.vue";
import { useSessions } from "./composables/useSessions";
import { useAppConfig } from "./composables/useAppConfig";
import { useFaviconState } from "./composables/useFaviconState";
import { useSoundEnabled } from "./composables/useSoundEnabled";
import { useAttentionSound, type SoundConfig } from "./composables/useAttentionSound";
import { useUnloadGuard } from "./composables/useUnloadGuard";
import { usePubSub } from "./composables/usePubSub";
import { openTerminalAt } from "./composables/useNewTerminal";
import { installDataTips } from "./composables/useDataTips";
import { useWhatsNew } from "./composables/useWhatsNew";
import { useI18n } from "vue-i18n";
import { LAUNCH_TERMINAL_CHANNEL, isLaunchAgent, type LaunchAgent } from "../common/launchAgent";
import { isRecord } from "../common/isRecord";

// The phone asked for a new terminal in a session's directory (#831). The grid is browser state —
// the host can only ask — so SOMETHING has to be listening for this to be servable, and the host
// tells the phone outright when nothing is. Subscribed here rather than in GridView because this
// component is the one that certainly exists: the grid is mounted for the life of the page now,
// but openTerminalAt already queues and brings it on screen, so the seam costs nothing to keep.
const launchRequestOf = (data: unknown): { cwd: string; agent: LaunchAgent } | null => {
  if (!isRecord(data)) return null;
  const { cwd, agent } = data;
  return typeof cwd === "string" && cwd && isLaunchAgent(agent) ? { cwd, agent } : null;
};
// Appended at the end of the grid: the phone has no notion of which desktop cell is
// "current", and guessing would drop the terminal somewhere arbitrary.
const unsubscribeLaunch = usePubSub().subscribe(LAUNCH_TERMINAL_CHANNEL, (data) => {
  const request = launchRequestOf(data);
  if (request) openTerminalAt(request.cwd, null, request.agent);
});
onUnmounted(unsubscribeLaunch);

// `title`'s tip waits on the browser; every `data-tip` opens the shared one at once instead.
onUnmounted(installDataTips());

// Warn on close/reload while anything is running. The grid reports its own count; nothing else
// reports one any more, now that there is no second view holding a PTY of its own.
useUnloadGuard();

// The session list, for the favicon below. Owned here rather than in the grid because it is about
// the TAB, not about what is on screen — a session needing attention on a background page still
// has to reach the favicon.
const { sessions } = useSessions();

// Beep when any session needs attention (waiting), including terminals on background grid pages.
// Listens to the "sessions" activity stream directly (same source as the cell status), independent
// of the fetched list above.
const { enabled: soundEnabled } = useSoundEnabled();
// The sound settings are shared singletons in useAppConfig, so the player here sees changes made
// from the settings modal (which the grid owns and hydrates).
const { soundFile, soundKinds, sounds } = useAppConfig();
const soundConfig = computed<SoundConfig>(() => ({ kinds: soundKinds.value, sounds: sounds.value, soundFile: soundFile.value }));
useAttentionSound(soundEnabled, soundConfig);

// Reflect session activity in the tab's favicon (idle / working / attention).
useFaviconState(sessions);

// After an upgrade, the release guides for every version since the dialog was last closed.
const { whatsNew, dismiss: dismissWhatsNew } = useWhatsNew(useI18n().locale.value);
</script>

<template>
  <GridView />
  <!-- The full-screen overlays, on TOP of the grid rather than instead of it. Each is route-driven
       and starts below the header (`top-10`), so the toolbar stays on screen and the view beneath
       one does not change while it is open (#1193). -->
  <!-- Full-screen collection / feed browser; shown when the toolbar's Collections door, an index
       card or a ref hop opens it (driven by useCollectionBrowse). -->
  <CollectionsBrowseOverlay />
  <!-- Full-screen accounting view; opened from the first button on the Collections screen's top row
       (driven by useAccountingView). Mutually exclusive with the browser above. -->
  <AccountingOverlay />
  <!-- Full-screen read-only wiki browser; opened by the toolbar's menu_book button
       (driven by useWikiBrowse). Mutually exclusive with the overlays above. -->
  <WikiBrowseOverlay />
  <!-- Full-screen cross-repo PR list; opened by the toolbar's Pull requests button. -->
  <GithubOverlay />
  <GithubBoardOverlay />
  <!-- The conversation rooms a round table writes to; opened by the toolbar's forum button, or
       from a cell's round-table menu on the room that table is filling. -->
  <RoomsOverlay />
  <!-- Blueprint builds; opened by the toolbar's architecture button. -->
  <BlueprintsOverlay />
  <!-- Every skill on disk across the folders terminals ran in; opened from the feature menu. -->
  <SkillsOverlay />
  <!-- What each session is running, and worktrees that can go; opened from the feature menu. -->
  <ProcessesOverlay />
  <UsageOverlay />
  <!-- Full-screen file explorer + editor; opened by the toolbar's Files button, or by a terminal
       header's Files button rooted at that terminal's own directory. -->
  <FilesOverlay />
  <!-- The one hover tip every cell-header chip opens (#1235). Mounted here, and only here, so the
       document can never hold two — it teleports to <body> and positions itself against whichever
       chip the pointer is on. -->
  <HoverTip />
  <WhatsNewDialog v-if="whatsNew" :whats-new="whatsNew" @close="dismissWhatsNew" />
  <!-- Over everything, including the settings modal it was pressed in: once the server is gone
       nothing behind it works, and a live-looking pane underneath would say otherwise (#1820). -->
  <ServerStoppedOverlay />
  <!-- The right-click menu on a path in terminal output (#3238): one for every terminal, wherever it is mounted. -->
  <TerminalLinkMenu />
  <!-- A celebration over everything (the confetti shortcut, an opted-in event, the Konami code); takes no clicks. -->
  <ConfettiOverlay />
</template>
