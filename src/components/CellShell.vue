<script setup lang="ts">
// The frame and header shared by the grid's NON-AGENT cells — the command cell (a script.json
// Run) and the launcher cell (a configured program). Both are "a process in a cell": one dot, one
// directory, one name, the same reorder and chrome buttons, and a body below.
//
// It exists because those two rendered the same nine elements with only the wording different, and
// jscpd kept reporting the frame as a clone (#1127). TerminalCell deliberately does NOT use this:
// its header carries git / work / model / context / usage / memo chips and an editable note, which
// is a different thing wearing the same border.
//
// Single root on purpose: the grid hands each cell `data-uid` and a per-cell class, and a fragment
// root would drop both — the same failure mode that made scoped CSS silently miss (#787).
import { computed, toRef } from "vue";
import DirBadge from "./DirBadge.vue";
import DirIcon from "./DirIcon.vue";
import CellChromeButtons from "./CellChromeButtons.vue";
import CellPathMenu from "./CellPathMenu.vue";
import CockpitRowMenu from "./CockpitRowMenu.vue";
import type { RowMenuModel } from "./thumbnailRowMenu";
import { cellChromeBinding, type CellChromeSource } from "./cellChromeBinding";
import { useCellChrome } from "../composables/useCellChrome";
import { formatCwd } from "./cwdDisplay";
import { isSameDirPath } from "../../common/dirPathKey";
import { HOVER_TIP_ID, useHoverTipAnchor } from "../composables/useHoverTip";
import { textTip } from "./tipContent";
import { shouldZoomOnHeaderClick } from "./cellHeaderZoom";
import {
  CELL_ACTIONS,
  CELL_BTN,
  CELL_CMD,
  CELL_DIR,
  CELL_DIR_PATH,
  CELL_DOT,
  CELL_DOT_IDLE,
  CELL_DOT_WORKING,
  CELL_FRAME,
  CELL_HEADER,
  CELL_HEADER_ZOOMABLE,
  CELL_INNER,
} from "./cellChromeClasses";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// A whole sentence per noun, not the noun interpolated: the noun itself needs translating, and
// where it sits in the sentence differs by language.
const MOVE_ARIA = {
  command: { left: "tips.cell.moveCommandLeft", right: "tips.cell.moveCommandRight" },
  launcher: { left: "tips.cell.moveLauncherLeft", right: "tips.cell.moveLauncherRight" },
} as const;

// CellChromeSource rather than GridCellProps: those props are OPTIONAL upstream, so under
// exactOptionalPropertyTypes they read as `T | undefined` and cannot be handed to a `?: T` prop.
// CellChromeSource spells the `| undefined` out, and is the same set cellChromeBinding consumes.
// `zoomed` is deliberately absent — only the callers' TerminalView cares about it.
const props = defineProps<
  CellChromeSource & {
    home: string | null;
    cwd: string | null;
    // The server's workspace dir, so the badge can say WORKSPACE rather than the folder's own name
    // — the same thing TerminalCell does with the prop of the same name. A command or launcher cell
    // running in the workspace is as much "the workspace" as an agent cell is.
    defaultCwd?: string | null | undefined;
    // Whether the process has ended. Drives the dot only — what "ended" MEANS differs (a command
    // finishes, a launcher exits), which is why the word is the caller's.
    finished: boolean;
    idleTitle: string;
    // Material Symbols name and the text beside it: the cell says what it is running.
    icon: string;
    label: string;
    // "command" / "launcher", for the reorder buttons' aria-labels. Screen-reader text, so it
    // names the thing being moved rather than saying "cell" twice.
    moveNoun: "command" | "launcher";
    reorderable?: boolean;
    // A filmstrip thumbnail: the directory and close only, like a session cell's thumbnail.
    thumbnail?: boolean;
    // The terminal slot the path menu's Insert a file path types into, or null when this cell's
    // terminal cannot be addressed from outside (see CellPathMenu).
    slotKey: string | null;
    // A filmstrip thumbnail's ⋮ (the roster row's menu), or null. Command and launcher cells cannot
    // be set aside or marked, so theirs holds moving and closing.
    rowMenu?: RowMenuModel | null | undefined;
    panesHidden?: boolean;
  }
>();

const emit = defineEmits<{
  (e: "toggle-expand" | "close" | "toggle-canvas" | "toggle-tools" | "toggle-collections" | "toggle-prompts" | "toggle-transcript" | "open-files"): void;
  (e: "move", dir: -1 | 1): void;
  // A path-menu action failed; the caller shows it on its terminal's banner.
  (e: "path-problem", message: string): void;
}>();

const { chromeProps, chromeEvents } = cellChromeBinding(props, emit);

// The name badge and the header/frame tints are CHROME — this cell's own header, not the terminal
// canvas (#914). The canvas side resolves itself inside Terminal.vue (#911).
const { config: dirConfig, cellStyle, headerStyle } = useCellChrome(toRef(() => props.cwd));

const dirDisplay = computed(() => formatCwd(props.cwd, props.home));

const isWorkspace = computed(() => isSameDirPath(props.cwd, props.defaultCwd));

// The header shows the path shortened to fit; the tip is the full one. Anchored on the dir span
// only — the running/idle dot beside it keeps its `title`, since a two-word state does not need a
// panel and the dot is not what anyone hovers to read.
const { described: dirDescribed, show: showDirTip, hide: hideDirTip } = useHoverTipAnchor(() => textTip(props.cwd));

// Clicking the header background zooms (switches to) this cell, except the already-expanded one.
// Buttons keep their action.
function onHeaderClick(event: MouseEvent) {
  if (shouldZoomOnHeaderClick(event.target, props.expanded, props.hideExpand)) emit("toggle-expand");
}
</script>

<template>
  <div class="cell" :class="CELL_FRAME" :style="cellStyle">
    <div :class="CELL_INNER">
      <div class="cell-header" :class="[CELL_HEADER, expanded ? '' : `is-zoomable ${CELL_HEADER_ZOOMABLE}`]" :style="headerStyle" @click="onHeaderClick">
        <!-- Leads the row, ahead of the status dot — the browser-tab position (see TerminalCell). -->
        <DirIcon :src="dirConfig.iconUrl" />
        <span
          class="cell-dot"
          :class="[CELL_DOT, finished ? `is-idle ${CELL_DOT_IDLE}` : `is-working ${CELL_DOT_WORKING}`]"
          :data-tip="finished ? idleTitle : t('tips.cell.running')"
        />
        <CellPathMenu
          v-if="!thumbnail && dirDisplay"
          :cwd="cwd"
          :label="dirDisplay"
          :slot-key="slotKey"
          layout="inline"
          @open-files="emit('open-files')"
          @reveal-failed="(message) => emit('path-problem', message)"
          @insert-failed="(message) => emit('path-problem', message)"
        />
        <span
          v-else-if="dirDisplay"
          class="cell-dir"
          :class="CELL_DIR"
          :aria-describedby="dirDescribed ? HOVER_TIP_ID : undefined"
          @pointerenter="showDirTip"
          @pointerleave="hideDirTip"
          @focusin="showDirTip"
          @focusout="hideDirTip"
          ><span class="cell-dir-path" :class="CELL_DIR_PATH">{{ dirDisplay }}</span></span
        >
        <!-- Not on a thumbnail: the badge does not shrink, and at 260px it pushed close out of view. -->
        <DirBadge v-if="!thumbnail" :name="dirConfig.name" :color="dirConfig.badgeColor" :workspace="isWorkspace" />
        <span class="cell-cmd" :class="CELL_CMD"
          ><span class="material-symbols-outlined" aria-hidden="true">{{ icon }}</span
          ><template v-if="!thumbnail"> {{ label }}</template></span
        >
        <span class="cell-actions" :class="CELL_ACTIONS">
          <button
            v-if="reorderable && !thumbnail"
            class="cell-btn"
            :class="CELL_BTN"
            :data-tip="t('tips.cell.moveLeft')"
            :aria-label="t(MOVE_ARIA[moveNoun].left)"
            @click="emit('move', -1)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">chevron_left</span>
          </button>
          <button
            v-if="reorderable && !thumbnail"
            class="cell-btn"
            :class="CELL_BTN"
            :data-tip="t('tips.cell.moveRight')"
            :aria-label="t(MOVE_ARIA[moveNoun].right)"
            @click="emit('move', 1)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
          </button>
          <!-- Whatever this particular cell can do, between the reorder buttons and the chrome
               ones — which is where both callers already had theirs. -->
          <slot v-if="!thumbnail" name="actions" />
          <CockpitRowMenu v-if="thumbnail && rowMenu" v-bind="rowMenu" axis="horizontal" @move="(dir) => emit('move', dir)" @close="emit('close')" />
          <CellChromeButtons v-bind="chromeProps" :close-only="thumbnail" :panes-hidden="panesHidden" v-on="chromeEvents" />
        </span>
      </div>
      <slot />
    </div>
  </div>
</template>
