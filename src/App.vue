<script setup lang="ts">
// The application shell, and by now almost nothing: the grid IS the app, and the full-screen
// overlays render on top of it. What is left here is the handful of concerns that belong to the
// PAGE rather than to any view — a launch request arriving from the phone, the attention sound,
// the favicon, the close guard.
//
// The single terminal view lived here until #1202. Everything it owned has a home in the grid: the
// settings modal (GridView's own), the tools and Canvas panes (beside a zoomed cell), the session
// list (the cockpit roster, and the launcher's resume list for sessions off the grid), and the
// content surfaces (the Collections door in the toolbar). What it uniquely had — one terminal
// filling the window — is a zoomed cell.
import { computed, onUnmounted } from "vue";
import CollectionsBrowseOverlay from "./components/CollectionsBrowseOverlay.vue";
import AccountingOverlay from "./components/AccountingOverlay.vue";
import WikiBrowseOverlay from "./components/WikiBrowseOverlay.vue";
import PrsOverlay from "./components/PrsOverlay.vue";
import FilesOverlay from "./components/FilesOverlay.vue";
import GridView from "./components/GridView.vue";
import { useSessions } from "./composables/useSessions";
import { useAppConfig } from "./composables/useAppConfig";
import { useFaviconState } from "./composables/useFaviconState";
import { useSoundEnabled } from "./composables/useSoundEnabled";
import { useAttentionSound, type SoundConfig } from "./composables/useAttentionSound";
import { useUnloadGuard } from "./composables/useUnloadGuard";
import { usePubSub } from "./composables/usePubSub";
import { openTerminalAt } from "./composables/useNewTerminal";
import { LAUNCH_TERMINAL_CHANNEL, isLaunchAgent, type LaunchAgent } from "../common/launchAgent";

// The phone asked for a new terminal in a session's directory (#831). The grid is browser state —
// the host can only ask — so SOMETHING has to be listening for this to be servable, and the host
// tells the phone outright when nothing is. Subscribed here rather than in GridView because this
// component is the one that certainly exists: the grid is mounted for the life of the page now,
// but openTerminalAt already queues and brings it on screen, so the seam costs nothing to keep.
const launchRequestOf = (data: unknown): { cwd: string; agent: LaunchAgent } | null => {
  if (typeof data !== "object" || data === null) return null;
  const { cwd, agent } = data as { cwd?: unknown; agent?: unknown };
  return typeof cwd === "string" && cwd && isLaunchAgent(agent) ? { cwd, agent } : null;
};
// Appended at the end of the grid: the phone has no notion of which desktop cell is
// "current", and guessing would drop the terminal somewhere arbitrary.
const unsubscribeLaunch = usePubSub().subscribe(LAUNCH_TERMINAL_CHANNEL, (data) => {
  const request = launchRequestOf(data);
  if (request) openTerminalAt(request.cwd, null, request.agent);
});
onUnmounted(unsubscribeLaunch);

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
</script>

<template>
  <GridView />
  <!-- The full-screen overlays, on TOP of the grid rather than instead of it. Each is route-driven
       and starts below the header (`top-10`), so the toolbar stays on screen and the view beneath
       one does not change while it is open (#1193). -->
  <!-- Full-screen collection / feed browser; shown when the toolbar's Collections door, an index
       card or a ref hop opens it (driven by useCollectionBrowse). -->
  <CollectionsBrowseOverlay />
  <!-- Full-screen accounting view; opened by the toolbar's account_balance button
       (driven by useAccountingView). Mutually exclusive with the browser above. -->
  <AccountingOverlay />
  <!-- Full-screen read-only wiki browser; opened by the toolbar's menu_book button
       (driven by useWikiBrowse). Mutually exclusive with the overlays above. -->
  <WikiBrowseOverlay />
  <!-- Full-screen cross-repo PR list; opened by the toolbar's call_merge button. -->
  <PrsOverlay />
  <!-- Full-screen file explorer + editor; opened by the toolbar's Files button, or by a terminal
       header's Files button rooted at that terminal's own directory. -->
  <FilesOverlay />
</template>
