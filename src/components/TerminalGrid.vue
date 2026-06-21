<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import TerminalCell from "./TerminalCell.vue";
import { MAX_CELLS, dims, trackStyle, type Layout } from "./gridLayout";
import type { CwdPreset } from "./presets";

// Zooming interface: the grid is the base view; expanding a cell switches to a
// filmstrip layout — the zoomed cell fills the top, the other cells line up in a
// horizontally-scrolling strip below (click any cell's ⤢ to swap which is zoomed).
// Cells stay MOUNTED across the switch (moved with <Teleport>, not re-created), so
// their terminals keep running instead of reconnecting. The layout (cell
// arrangement) is chosen in the toolbar. `defaultCwd` prefills the launch form;
// `presets` are the quick-pick dirs; `home` anchors the cell header path on ~.
const props = defineProps<{ layout: Layout; defaultCwd: string | null; presets: CwdPreset[]; home: string | null }>();

const cellCount = computed(() => dims(props.layout).cellCount);

// Each cell is a persistent SLOT with a stable `uid`. The slots array's ORDER is
// the display order; the visible cells are the first `cellCount`. v-for keys by
// uid, so reordering the array (compaction) MOVES the cell instances — the running
// terminals follow their slot instead of reconnecting.
interface Slot {
  uid: number;
  session: string | null;
  cwd: string | null;
}

// Persisted so a page reload restores the open terminals and the zoom state.
const STORE_KEY = "grid_state_v1";
// Session ids are UUIDs. Drop anything else from a stale/tampered localStorage so
// a cell never mounts with an invalid id (which the server rejects, leaving the
// terminal reconnecting forever).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadState(): { slots: Slot[]; expandedUid: number | null } {
  const sessions = Array<string | null>(MAX_CELLS).fill(null);
  const cwds = Array<string | null>(MAX_CELLS).fill(null);
  let expandedIndex: number | null = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "");
    for (let i = 0; i < MAX_CELLS; i++) {
      const v = parsed?.sessions?.[i];
      if (typeof v === "string" && UUID_RE.test(v)) sessions[i] = v;
      const c = parsed?.cwds?.[i];
      if (typeof c === "string") cwds[i] = c;
    }
    const e = parsed?.expanded;
    if (typeof e === "number" && e >= 0 && e < MAX_CELLS) expandedIndex = e;
  } catch {
    // no/invalid state — defaults
  }
  // uid === initial index; the order changes via compaction, the uid never does.
  const slots = Array.from({ length: MAX_CELLS }, (_, i) => ({ uid: i, session: sessions[i], cwd: cwds[i] }));
  return { slots, expandedUid: expandedIndex };
}

const initial = loadState();
const slots = ref<Slot[]>(initial.slots);
const expandedUid = ref<number | null>(initial.expandedUid);

const visibleSlots = computed(() => slots.value.slice(0, cellCount.value));
const slotByUid = (uid: number) => slots.value.find((s) => s.uid === uid);
const slotPos = (uid: number) => slots.value.findIndex((s) => s.uid === uid);

// Persist as position-indexed arrays (+ the expanded cell's position) so the
// on-disk shape is unchanged across this refactor.
watch(
  [slots, expandedUid],
  () =>
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        sessions: slots.value.map((s) => s.session),
        cwds: slots.value.map((s) => s.cwd),
        expanded: expandedUid.value === null ? null : slotPos(expandedUid.value),
      }),
    ),
  { deep: true },
);

// Pack the running terminals to the front (top-left), empties to the back, keeping
// relative order. Stable uids mean the live cells move without remounting.
function compact() {
  const occupied = slots.value.filter((s) => s.session !== null);
  const empty = slots.value.filter((s) => s.session === null);
  slots.value = [...occupied, ...empty];
}

// On a layout change, re-pack so the running terminals stay visible (top-left), and
// drop the zoom if the expanded cell fell outside the new, smaller layout.
watch(cellCount, () => {
  compact();
  if (expandedUid.value !== null) {
    const pos = slotPos(expandedUid.value);
    if (pos < 0 || pos >= cellCount.value) expandedUid.value = null;
  }
});

function toggleExpand(uid: number) {
  const next = expandedUid.value === uid ? null : uid;
  expandedUid.value = next;
  // Restoring → pack the grid so the running terminals are top-left and easy to
  // find. We compact on RESTORE (grid mode), not on zoom: reordering cells while
  // they're teleported into the filmstrip is unreliable, so the strip is sorted
  // purely with CSS `order` (stripOrder) instead — no DOM move.
  if (next === null) compact();
}

// While zoomed, push empty cells to the end of the filmstrip strip so the open
// terminals line up on the left. Pure CSS order — never reorders the DOM (which
// would fight the <Teleport>).
const stripOrder = (slot: Slot) => (zoomed.value && slot.uid !== expandedUid.value && slot.session === null ? { order: 1 } : undefined);

function setSession(uid: number, id: string | null) {
  const s = slotByUid(uid);
  if (!s) return;
  s.session = id;
  if (id === null && expandedUid.value === uid) expandedUid.value = null; // a closed cell can't stay zoomed
}

function setCwd(uid: number, cwd: string) {
  const s = slotByUid(uid);
  if (s) s.cwd = cwd;
}

// Closing a cell empties its slot and packs the gap right away, so the remaining
// terminals shift up to fill it.
function onClose(uid: number) {
  const s = slotByUid(uid);
  if (s) {
    s.session = null;
    s.cwd = null;
  }
  if (expandedUid.value === uid) expandedUid.value = null;
  compact();
}

// The grid (non-zoomed) always uses full equal tracks; the zoom layout is handled
// by the filmstrip scaffold below, not by collapsing grid tracks.
const gridStyle = computed(() => trackStyle(props.layout, null));

// Teleport targets for the filmstrip. They must be in the document before a cell
// relocates, so hold off until mounted (covers a page reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const zoomStrip = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));

const zoomed = computed(() => expandedUid.value !== null && mounted.value);
const cellTarget = (slot: Slot) => (expandedUid.value === slot.uid ? zoomMain.value : zoomStrip.value);
</script>

<template>
  <div class="stage" :class="{ zoomed }">
    <div ref="zoomMain" class="zoom-main" />
    <div ref="zoomStrip" class="zoom-strip" />
    <div class="grid" :style="gridStyle">
      <Teleport v-for="slot in visibleSlots" :key="slot.uid" :to="cellTarget(slot)" :disabled="!zoomed">
        <TerminalCell
          :style="stripOrder(slot)"
          :expanded="slot.uid === expandedUid"
          :initial-session-id="slot.session"
          :initial-cwd="slot.cwd"
          :default-cwd="defaultCwd"
          :presets="presets"
          :home="home"
          @toggle-expand="toggleExpand(slot.uid)"
          @session="(id) => setSession(slot.uid, id)"
          @cwd="(c) => setCwd(slot.uid, c)"
          @close="() => onClose(slot.uid)"
        />
      </Teleport>
    </div>
  </div>
</template>

<style scoped>
.stage {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: #0f0f1e;
}

.grid {
  flex: 1;
  min-height: 0;
  display: grid;
  padding: 6px;
  box-sizing: border-box;
}

/* Inert until a cell is zoomed. */
.zoom-main,
.zoom-strip {
  display: none;
}

.stage.zoomed .grid {
  display: none;
}

/* Filmstrip: the zoomed cell fills the top. */
.stage.zoomed .zoom-main {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  padding: 6px 6px 0;
}
.zoom-main > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* The other cells line up below and scroll horizontally when they overflow. */
.stage.zoomed .zoom-strip {
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
  height: 150px;
  padding: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}
.zoom-strip > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
}
</style>
