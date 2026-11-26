<script setup lang="ts">
import { computed, ref, watch } from "vue";
import TerminalView from "./Terminal.vue";
import CellShell from "./CellShell.vue";
import { cellShellEvents } from "./cellChromeBinding";
import { isShellLauncher, type CellLauncher } from "./gridTabs";
import { isThumbnail, type GridCellEmits, type GridCellProps } from "./gridCell";
import { CELL_BTN, CELL_TERM } from "./cellChromeClasses";
import { useI18n } from "vue-i18n";
import HostMark from "./HostMark.vue";
import RemoteHostGone from "./RemoteHostGone.vue";
import { useRemoteHostStatus } from "../composables/configuredRemoteHosts";
import { mayConnect } from "./remoteHostStatus";
import { onThisMachine } from "./remoteCell";

const { t } = useI18n();

// A grid cell running a configured launch command — any interactive program, run exactly as the
// user wrote it and never inspected. Unlike CommandCell this is PERSISTENT: it
// carries a session id and a durable connection (persistKey), so it survives page
// switches and reconnects — but it reports no activity of its own, so its status is only
// running (working) / exited (idle). `launcher.index` is the command's position in the
// configured launcher list (the server's allowlist); it runs in `cwd`.
//
// The frame, header and chrome buttons come from CellShell, which CommandCell shares.
const props = defineProps<
  GridCellProps & {
    uid: number;
    launcher: CellLauncher;
    session: string | null;
    cwd: string | null;
    // The remote host this launcher runs on (#3506), or null for this machine. See remoteCell.ts.
    remoteHost?: string | null;
    // Manual sort mode: show move buttons to swap this cell with its neighbour.
    reorderable?: boolean;
  }
>();
const thumbnail = computed(() => isThumbnail(props));
const emit = defineEmits<
  GridCellEmits & {
    // The server-assigned session id, so the parent persists it for reconnect.
    (e: "session", id: string): void;
  }
>();

const shellEvents = cellShellEvents(emit);

// connectKey bump re-launches after the process exits (relaunch button).
const connectKey = ref(0);
const termRef = ref<InstanceType<typeof TerminalView>>();
const finished = ref(false);

// The path menu acts on this machine's directory of that name, so a remote launcher offers none.
const localCwd = computed(() => onThisMachine(props.remoteHost, props.cwd));
const hostStatus = useRemoteHostStatus(props.remoteHost);
const target = computed(() => (isShellLauncher(props.launcher) ? { shell: true as const } : { index: props.launcher.index }));

// Running counts as "working"; once the process exits it's idle (never "waiting").
watch(finished, (done) => emit("status", done ? "idle" : "working"), { immediate: true });

function onSession(id: string) {
  emit("session", id);
}
function onExit() {
  finished.value = true;
}
function relaunch() {
  finished.value = false;
  connectKey.value++;
}
</script>

<template>
  <CellShell
    :expanded="expanded"
    :right-pane="rightPane"
    :canvas-available="canvasAvailable"
    :collections-available="collectionsAvailable"
    :home="home"
    :cwd="localCwd"
    :default-cwd="defaultCwd"
    :finished="finished"
    :idle-title="t('tips.cell.exited')"
    icon="rocket_launch"
    :label="launcher.label"
    move-noun="launcher"
    :reorderable="reorderable"
    :thumbnail="thumbnail"
    :row-menu="rowMenu"
    :slot-key="`cell-${uid}`"
    :panes-hidden="!!remoteHost"
    v-on="shellEvents"
    @path-problem="(message) => void termRef?.showHint(message, 'folder_open')"
  >
    <template #actions>
      <HostMark v-if="remoteHost" :host="remoteHost" />
      <button v-if="finished" class="cell-btn" :class="CELL_BTN" :data-tip="t('tips.cell.relaunch')" :aria-label="t('tips.cell.relaunch')" @click="relaunch">
        <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      </button>
    </template>
    <RemoteHostGone v-if="remoteHost && hostStatus === 'gone'" :host="remoteHost" />
    <TerminalView
      v-else-if="mayConnect(hostStatus)"
      ref="termRef"
      class="cell-term"
      :class="CELL_TERM"
      :persist-key="`cell-${uid}`"
      :session-id="session"
      :connect-key="connectKey"
      :cwd="cwd"
      :launcher="target"
      :remote-host="remoteHost ?? null"
      :expanded="expanded"
      :zoomed="zoomed"
      :hide-header="thumbnail"
      :path-menu-picker="!thumbnail"
      @session="onSession"
      @exit="onExit"
    />
  </CellShell>
</template>
