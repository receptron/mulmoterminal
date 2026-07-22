<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { router } from "./router";
import Sidebar from "./components/Sidebar.vue";
import SessionTabBar from "./components/SessionTabBar.vue";
import TerminalView from "./components/Terminal.vue";
import GuiPanel from "./components/GuiPanel.vue";
import ToolsPane from "./components/ToolsPane.vue";
import CollectionsBrowseOverlay from "./components/CollectionsBrowseOverlay.vue";
import AccountingOverlay from "./components/AccountingOverlay.vue";
import WikiBrowseOverlay from "./components/WikiBrowseOverlay.vue";
import PrsOverlay from "./components/PrsOverlay.vue";
import FilesOverlay from "./components/FilesOverlay.vue";
import GridView from "./components/GridView.vue";
import SettingsModal from "./components/SettingsModal.vue";
import AppToolbar from "./components/AppToolbar.vue";
import { useSessions, type Filter } from "./composables/useSessions";
import { browseClose } from "./composables/useCollectionBrowse";
import { registerChatOpener, startCollectionChat } from "./composables/useChatLauncher";
import { useAppConfig } from "./composables/useAppConfig";
import { useDirConfig } from "./composables/useDirConfig";
import { useFaviconState } from "./composables/useFaviconState";
import { usePendingScript, type PendingCommand } from "./composables/usePendingScript";
import { useSoundEnabled } from "./composables/useSoundEnabled";
import { useAttentionSound } from "./composables/useAttentionSound";
import { useUnloadGuard, reportActiveTerminals } from "./composables/useUnloadGuard";
import { browserLocale } from "./utils/browserLocale";
import { clampTerminalWidth, maxTerminalWidth, MIN_TERMINAL, splitterKeyWidth } from "./components/splitterWidth";

// View mode is now the URL: the multi-terminal grid is /terminals, everything else
// (chat + the collection/accounting overlays) lives under the single-view shell.
const route = useRoute();
const isGrid = computed(() => route.name === "terminals");

// A script picked from the terminal header's Run menu runs in the grid (command
// cells live only there): stash it and switch to the grid, which picks it up.
const { requestRun } = usePendingScript();
function onRunScript(command: PendingCommand) {
  requestRun(command);
  router.push("/terminals");
}

const activeId = ref<string | null>(null);
// Which agent the single view runs (Claude by default). Codex connects to /ws/codex with the
// GUI MCP attached, so it drives the GUI panel like Claude.
const singleAgent = ref<"claude" | "codex">("claude");
const connectKey = ref(0);
const terminalRef = ref<InstanceType<typeof TerminalView> | null>(null);

// Confirm before an accidental tab close / reload while a terminal is live. The
// single view reports its own session (0 or 1) under the "single" key; the grid
// reports its running-cell count under "grid". They're summed, not overwritten,
// because persistent connections keep the single PTY alive even after switching to
// the grid — so a hidden-but-live single terminal must still count toward the guard.
useUnloadGuard();
watch(
  [isGrid, activeId],
  () => {
    // Only the single view owns the "single" count; in the grid, the single PTY may
    // still be live (persistent connections) so its last reported count stands.
    if (!isGrid.value) reportActiveTerminals("single", activeId.value ? 1 : 0);
  },
  { immediate: true },
);

// Single source of truth for the session list, owned here (not inside the
// layout components) so toggling vertical/horizontal — which swaps Sidebar and
// SessionTabBar via v-if/v-else — never unmounts the store, refetches, or resets
// the filter. Both layouts render this same shared state.
const { sessions, loading, error, refresh } = useSessions();
const filter = ref<Filter>("all");

// Beep when any session needs attention (waiting) — across the single and grid
// views, including terminals on background grid pages. Listens to the "sessions"
// activity stream directly (same source as the cell status), independent of the
// fetched list above.
const { enabled: soundEnabled } = useSoundEnabled();
// soundFile is a shared singleton in useAppConfig, so the player here sees changes
// made from either view's settings modal (and loadConfig below hydrates it).
const { soundFile } = useAppConfig();
useAttentionSound(soundEnabled, soundFile);

// Reflect session activity in the tab's favicon (idle / working / attention).
useFaviconState(sessions);

// Terminal column width (px), set by dragging the splitter between the terminal
// and the GUI panel; the GUI panel absorbs whatever is left. Persisted across
// reloads. The terminal's own ResizeObserver refits xterm's cols/rows as this
// changes, so a drag live-resizes the PTY.

const terminalWidth = ref<number>(Number(localStorage.getItem("terminal_width")) || 560);

// Track the viewport so the splitter's max (and aria-valuemax) stays correct and
// the saved width re-clamps when the window shrinks.
const viewportWidth = ref(window.innerWidth);
const maxTerminal = computed(() => maxTerminalWidth(viewportWidth.value));

function clampWidth(w: number): number {
  return clampTerminalWidth(w, viewportWidth.value);
}

function persistWidth() {
  localStorage.setItem("terminal_width", String(terminalWidth.value));
}

let stopDrag: (() => void) | null = null;
function startDrag(e: MouseEvent) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = terminalWidth.value;
  const onMove = (ev: MouseEvent) => {
    terminalWidth.value = clampWidth(startW + (ev.clientX - startX));
  };
  const onUp = () => {
    persistWidth();
    stopDrag?.();
  };
  stopDrag = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    stopDrag = null;
  };
  // Suppress text selection / keep the resize cursor for the whole drag.
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

// Keyboard resize for the separator (arrows nudge, Home/End jump to the limits)
// so the splitter is operable without a mouse.
function onSplitterKey(e: KeyboardEvent) {
  const next = splitterKeyWidth(e.key, terminalWidth.value, viewportWidth.value);
  // Null means the key is not ours — returning BEFORE preventDefault is what keeps the
  // separator from swallowing Tab and Escape while it has focus.
  if (next === null) return;
  terminalWidth.value = next;
  e.preventDefault();
  persistWidth();
}

function onViewportResize() {
  viewportWidth.value = window.innerWidth;
  terminalWidth.value = clampWidth(terminalWidth.value);
}
onMounted(() => window.addEventListener("resize", onViewportResize));

// Settings (theme + notification sound), shared with the grid view via useAppConfig
// and opened from the toolbar's gear button.
const { defaultCwd, loadConfig, saveSound, pushEnabled, savePushEnabled, prRepos, savePrRepos, launchers, saveLaunchers, userMcpServers, saveUserMcpServers } =
  useAppConfig();
// Drive the single view's dir overrides off the dir the terminal ACTUALLY runs in
// (reported by the server, which may resolve/fall back), not the static default — so
// the badge/theme/colors always track the active session. Falls back to the default
// until the terminal reports its cwd.
const activeCwd = ref<string | null>(null);
const effectiveCwd = computed(() => activeCwd.value ?? defaultCwd.value);
const { config: singleDirConfig } = useDirConfig(effectiveCwd);
const showSettings = ref(false);
onMounted(loadConfig);
function closeSettings() {
  showSettings.value = false;
}
onUnmounted(() => {
  stopDrag?.();
  window.removeEventListener("resize", onViewportResize);
});

// Session-history layout: "vertical" (left Sidebar) or "horizontal" (top
// SessionTabBar), mirroring mulmoclaude's two history layouts. Persisted across
// reloads like the tools pane.
type Layout = "vertical" | "horizontal";
const layout = ref<Layout>(localStorage.getItem("session_layout") === "horizontal" ? "horizontal" : "vertical");
watch(layout, (v) => localStorage.setItem("session_layout", v));
function toggleLayout() {
  layout.value = layout.value === "vertical" ? "horizontal" : "vertical";
}

// Tools pane visibility, persisted across reloads (mirrors MulmoClaude's
// right-sidebar toggle).
const showTools = ref(localStorage.getItem("tools_pane_visible") === "true");
watch(showTools, (v) => localStorage.setItem("tools_pane_visible", String(v)));
function toggleTools() {
  showTools.value = !showTools.value;
}

// GUI -> LLM: a plugin view (e.g. a submitted form) calls this with the user's
// response. Terminal.submitText types it into the PTY and submits it (text + a
// delayed CR, both pinned to the same socket). Returns whether it was delivered
// so the caller only locks/persists on success.
function sendTextMessage(text: string): boolean {
  return terminalRef.value?.submitText(text) ?? false;
}

// Open a fresh session that auto-runs the mulmoterminal-config skill (rather than hijacking the
// active session), and select it so it shows. The skill then asks which directory / batch. codex
// rewriting is handled server-side (spawnBackgroundChat → codexifySkillSeed).
function configureAppearance(): void {
  void startCollectionChat("/mulmoterminal-config");
  showSettings.value = false;
}

function selectSession(id: string, agent: "claude" | "codex" = "claude") {
  if (id !== activeId.value) clearDraftHint(); // switching away from a preparing draft
  singleAgent.value = agent; // resume the row's agent (codex rows reconnect via /ws/codex)
  activeId.value = id;
  connectKey.value++;
}

// A transient "preparing your draft…" hint, shown over the terminal while a draft
// chat boots and its text is typed into claude's input box (a few seconds), so the
// brief delay doesn't look like nothing happened. Auto-dismisses.
const DRAFT_HINT_EN = "Preparing your draft — it'll appear in the input box in a moment. Review it, then press Enter to send.";
const draftHint = ref(false);
const draftHintText = ref(DRAFT_HINT_EN);
let draftHintTimer: ReturnType<typeof setTimeout> | undefined;
// Localize the hint via the same runtime translation route the collection UX uses
// (English fallback while it resolves / on failure). The host has no static i18n, so
// this keeps the one new user-facing string from being English-only. Translated once
// per session; the server cache makes it instant thereafter.
async function localizeDraftHint() {
  const locale = browserLocale();
  if (locale === "en" || draftHintText.value !== DRAFT_HINT_EN) return;
  try {
    const res = await fetch("/api/translation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ namespace: "mulmoterminal-ui", targetLanguage: locale, sentences: [DRAFT_HINT_EN] }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { translations?: string[] };
    if (typeof data.translations?.[0] === "string") draftHintText.value = data.translations[0];
  } catch {
    // leave the English fallback
  }
}
function showDraftHint() {
  draftHint.value = true;
  clearTimeout(draftHintTimer);
  draftHintTimer = setTimeout(() => (draftHint.value = false), 6000);
  localizeDraftHint();
}
function clearDraftHint() {
  clearTimeout(draftHintTimer);
  draftHint.value = false;
}
onUnmounted(() => clearTimeout(draftHintTimer));

// A collection action spawned a new chat and wants it shown: close the browse overlay
// (if open) and select the session so the terminal displays it. A draft also shows the
// preparing hint until claude is ready for the prefilled text.
registerChatOpener((id, opts) => {
  browseClose();
  selectSession(id, opts?.agent ?? "claude");
  if (opts?.draft) showDraftHint();
});

function newSession() {
  singleAgent.value = "claude";
  activeId.value = null;
  connectKey.value++;
}

function newCodexSession() {
  singleAgent.value = "codex";
  activeId.value = null;
  connectKey.value++;
}

// The server reports the live session id (a generated id for new sessions).
// Adopt it as the active id so it highlights. The sidebar list itself is
// driven server-side: the server publishes the new session on the "sessions"
// channel, so no client-side reload is needed here.
function onSession(id: string) {
  activeId.value = id;
}
</script>

<template>
  <!-- Keep the grid mounted across top-tab switches: leaving it deactivates (caches) the
       component instead of unmounting it, so returning restores the exact same DOM — no
       re-fetch of dir configs, no cell re-render, no re-fit — instead of rebuilding it. -->
  <KeepAlive>
    <GridView v-if="isGrid" />
  </KeepAlive>
  <div v-if="!isGrid" class="flex h-screen w-screen flex-col overflow-hidden">
    <AppToolbar @settings="showSettings = true" />
    <div :class="['flex min-h-0 w-full flex-1 overflow-hidden', layout === 'horizontal' ? 'flex-col' : 'flex-row']">
      <Sidebar
        v-if="layout === 'vertical'"
        v-model:filter="filter"
        :sessions="sessions"
        :loading="loading"
        :error="error"
        :active-id="activeId"
        @select="selectSession"
        @new="newSession"
        @new-codex="newCodexSession"
        @toggle-layout="toggleLayout"
        @refresh="refresh"
      />
      <SessionTabBar
        v-else
        v-model:filter="filter"
        :sessions="sessions"
        :active-id="activeId"
        @select="selectSession"
        @new="newSession"
        @new-codex="newCodexSession"
        @toggle-layout="toggleLayout"
        @refresh="refresh"
      />
      <div class="relative flex min-h-0 min-w-0 flex-1">
        <Transition
          enter-active-class="transition-opacity duration-[250ms] ease-[ease]"
          leave-active-class="transition-opacity duration-[250ms] ease-[ease]"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <div
            v-if="draftHint"
            class="pointer-events-none absolute left-1/2 top-3 z-20 flex max-w-[min(90%,640px)] -translate-x-1/2 items-center gap-2 rounded-lg border-2 border-[#c98a00] bg-[#ffd54a] px-4 py-2.5 font-sans text-[13px] font-semibold leading-[1.4] text-[#1a1a2e] shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
            role="status"
          >
            <span class="material-symbols-outlined shrink-0 text-[18px]" aria-hidden="true">edit_note</span>
            <span>{{ draftHintText }}</span>
          </div>
        </Transition>
        <TerminalView
          ref="terminalRef"
          class="min-w-0"
          :style="{ flex: `0 0 ${terminalWidth}px` }"
          persist-key="single"
          :session-id="activeId"
          :codex="singleAgent === 'codex'"
          :connect-key="connectKey"
          :dir-theme="singleDirConfig.theme"
          :dir-colors="singleDirConfig.colors"
          :dir-name="singleDirConfig.name"
          :dir-badge-color="singleDirConfig.badgeColor"
          :dir-header-color="singleDirConfig.headerColor"
          :dir-header-text-color="singleDirConfig.headerTextColor"
          :dir-button-color="singleDirConfig.buttonColor"
          run-menu
          @session="onSession"
          @cwd="(c) => (activeCwd = c)"
          @run="onRunScript"
        />
        <div
          class="shrink-0 grow-0 basis-[5px] cursor-col-resize border-l border-r border-border bg-panel hover:bg-hover focus-visible:bg-accent focus-visible:outline-none"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-label="Resize terminal"
          :aria-valuenow="terminalWidth"
          :aria-valuemin="MIN_TERMINAL"
          :aria-valuemax="maxTerminal"
          title="Drag (or use arrow keys) to resize the terminal"
          @mousedown="startDrag"
          @keydown="onSplitterKey"
        />
        <GuiPanel :session-id="activeId" :send-text-message="sendTextMessage" :tools-open="showTools" @toggle-tools="toggleTools" />
        <ToolsPane v-if="showTools" :session-id="activeId" @close="toggleTools" />
      </div>
    </div>
    <!-- Full-screen collection browser; shown when the launcher / an index card / a
         ref hop opens it (driven by useCollectionBrowse). -->
    <CollectionsBrowseOverlay />
    <!-- Full-screen accounting view; opened by the toolbar's account_balance button
         (driven by useAccountingView). Mutually exclusive with the browser above. -->
    <AccountingOverlay />
    <!-- Full-screen read-only wiki browser; opened by the toolbar's menu_book button
         (driven by useWikiBrowse). Mutually exclusive with the overlays above. -->
    <WikiBrowseOverlay />
    <!-- Full-screen cross-repo PR list; opened by the toolbar's call_merge button. -->
    <PrsOverlay />
    <!-- Full-screen file explorer + editor; opened by a terminal header's Files button. -->
    <FilesOverlay />
    <SettingsModal
      v-if="showSettings"
      :sound-file="soundFile"
      :push-enabled="pushEnabled"
      :pr-repos="prRepos"
      :launchers="launchers"
      :user-mcp-servers="userMcpServers"
      :cwd="effectiveCwd"
      :session-id="activeId"
      @update-sound="saveSound"
      @update-push-enabled="savePushEnabled"
      @update-repos="savePrRepos"
      @update-launchers="saveLaunchers"
      @update-user-mcp="saveUserMcpServers"
      @configure-appearance="configureAppearance"
      @close="closeSettings"
    />
  </div>
</template>
