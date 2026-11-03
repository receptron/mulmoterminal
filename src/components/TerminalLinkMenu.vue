<script setup lang="ts">
// The right-click menu on a path printed in terminal output (#3238). Mounted once, in App.vue: a
// terminal asks for it through terminalLinkMenu.ts with the link and the pointer, and it opens
// there. Four items — the pane (what a click does), a tab of its own, the Files view, the path —
// each decided in terminalLinkActions.ts, so this file is the look and the wiring.
import { nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { fitMenu, type MenuPoint } from "./rowMenu";
import { clipboardAvailable } from "./codeBlockCopy";
import { closeLinkMenu, linkMenuRequest, type HoveredLink } from "../composables/terminalLinkMenu";
import { absolutePathOf, openLinkInFiles, openLinkInPane, openLinkInTab, type LinkActionDeps } from "../composables/terminalLinkActions";
import { openOutsideFile, tryOpenInPane } from "../composables/filesPaneOpener";
import { filesGotoFile } from "../composables/useFilesView";

const { t } = useI18n();

const ITEM_CLASS =
  "flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-sans text-[13px] text-fg hover:bg-hover";
const ICON_CLASS = "material-symbols-outlined w-3.5 text-center text-[#4a9eff]";

const deps: LinkActionDeps = {
  openUrl: (url) => window.open(url, "_blank", "noopener,noreferrer"),
  openInFiles: (filePath, cwd, location) => filesGotoFile(cwd, filePath, location),
  openOutside: openOutsideFile,
  openInPane: tryOpenInPane,
};

const menu = useTemplateRef<HTMLElement>("menu");
const pos = ref<MenuPoint>({ top: 0, left: 0 });
const canCopy = clipboardAvailable();

/** What the last copy did, shown for a moment where the menu was: the menu has closed by then, and
 *  a refused write would otherwise look like a copy that happened (CodeRabbit on #3256). */
const NOTICE_MS = 2500;
const notice = ref<{ text: string; point: MenuPoint } | null>(null);
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
function say(text: string, point: MenuPoint): void {
  clearTimeout(noticeTimer);
  notice.value = { text, point };
  noticeTimer = setTimeout(() => (notice.value = null), NOTICE_MS);
}

// Placed once it has rendered, since only then is its size known: a right-click near an edge
// opens the menu inward rather than off-screen.
async function place(want: MenuPoint): Promise<void> {
  pos.value = want;
  await nextTick();
  const box = menu.value?.getBoundingClientRect();
  if (!box) return;
  pos.value = fitMenu(want, box, { width: window.innerWidth, height: window.innerHeight });
  menu.value?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
}
function onOutside(event: PointerEvent): void {
  const target = event.target instanceof Node ? event.target : null;
  if (!menu.value?.contains(target)) closeLinkMenu();
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeLinkMenu();
}
function listen(): void {
  window.addEventListener("pointerdown", onOutside);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("scroll", closeLinkMenu, true);
}
function unlisten(): void {
  window.removeEventListener("pointerdown", onOutside);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("scroll", closeLinkMenu, true);
}
watch(linkMenuRequest, (request, previous) => {
  if (request) {
    if (!previous) listen();
    void place(request.point);
  } else if (previous) {
    unlisten();
  }
});
onBeforeUnmount(() => {
  unlisten();
  closeLinkMenu();
  clearTimeout(noticeTimer);
});

// Every item closes the menu, then acts on the link it was opened for.
function pick(act: (link: HoveredLink, point: MenuPoint) => void): void {
  const request = linkMenuRequest.value;
  closeLinkMenu();
  if (request) act(request, request.point);
}
// The item is offered only where the browser gives a clipboard (clipboardAvailable), as the
// pane's copy is; a write it then refuses — no focus, no permission — is said, with the path, so
// the reader can take it by hand.
async function copyPath(link: HoveredLink, point: MenuPoint): Promise<void> {
  const text = absolutePathOf(link.text, link.cwd);
  try {
    await navigator.clipboard.writeText(text);
    say(t("linkMenu.copied"), point);
  } catch {
    say(t("linkMenu.copyFailed", { path: text }), point);
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="linkMenuRequest"
      ref="menu"
      data-testid="terminal-link-menu"
      role="menu"
      :aria-label="t('linkMenu.title')"
      class="fixed z-[60] min-w-[190px] max-w-[360px] rounded-lg border border-border bg-panel p-1.5 text-fg shadow-xl"
      :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
      @pointerdown.stop
      @contextmenu.prevent
    >
      <div class="truncate px-2.5 pb-1 font-mono text-[11px] text-dim" :data-tip="linkMenuRequest.text">{{ linkMenuRequest.text }}</div>
      <button type="button" role="menuitem" data-testid="link-open-pane" :class="ITEM_CLASS" @click="pick((link) => openLinkInPane(link, deps))">
        <span :class="ICON_CLASS" aria-hidden="true">view_sidebar</span> {{ t("linkMenu.openInPane") }}
      </button>
      <button type="button" role="menuitem" data-testid="link-open-tab" :class="ITEM_CLASS" @click="pick((link) => openLinkInTab(link, deps))">
        <span :class="ICON_CLASS" aria-hidden="true">open_in_new</span> {{ t("linkMenu.openInTab") }}
      </button>
      <button type="button" role="menuitem" data-testid="link-open-files" :class="ITEM_CLASS" @click="pick((link) => openLinkInFiles(link, deps))">
        <span :class="ICON_CLASS" aria-hidden="true">folder_open</span> {{ t("linkMenu.openInFiles") }}
      </button>
      <button
        v-if="canCopy"
        type="button"
        role="menuitem"
        data-testid="link-copy-path"
        :class="ITEM_CLASS"
        @click="pick((link, point) => void copyPath(link, point))"
      >
        <span :class="ICON_CLASS" aria-hidden="true">content_copy</span> {{ t("linkMenu.copyPath") }}
      </button>
    </div>
    <div
      v-if="notice"
      data-testid="terminal-link-notice"
      role="status"
      aria-live="polite"
      class="pointer-events-none fixed z-[60] max-w-[420px] rounded-md border border-border bg-panel px-2.5 py-1.5 text-[12px] text-fg shadow-lg"
      :style="{ top: `${notice.point.top}px`, left: `${notice.point.left}px` }"
    >
      {{ notice.text }}
    </div>
  </Teleport>
</template>
