<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from "vue";
import TerminalCell from "./TerminalCell.vue";
import { MAX_CELLS, dims, trackStyle, type Layout } from "./gridLayout";
import type { CwdPreset } from "./presets";
import { dbg } from "./debugLog"; // TEMP

// Zooming interface: the grid is the base view; expanding a cell switches to a
// filmstrip — the zoomed cell fills the top, the others line up in a
// horizontally-scrolling strip below (click any cell's ⤢ to swap which is zoomed).
// Only the ZOOMED cell is moved (with <Teleport>) up to the overlay; every other
// cell stays put in the grid, which is just restyled into the strip. Nothing else
// is relocated or re-created, so terminals keep running and headers never flicker.
// `defaultCwd` prefills the launch form; `presets` are the quick-pick dirs; `home`
// anchors the cell header path on ~.
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
  expandedUid.value = expandedUid.value === uid ? null : uid;
}

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

// The grid (non-zoomed) always uses full equal tracks; zoom restyles the grid into
// the bottom strip via CSS, so no track collapsing is needed.
const gridStyle = computed(() => trackStyle(props.layout, null));

// The zoomed cell is teleported up here; the target must exist before it moves, so
// hold off until mounted (covers a page reload that restores a zoom).
const zoomMain = ref<HTMLElement | null>(null);
const mounted = ref(false);
onMounted(() => (mounted.value = true));

const zoomed = computed(() => expandedUid.value !== null && mounted.value);

// TEMP debug — snapshot grid/DOM state after every zoom or slot change.
watch(
  [slots, expandedUid, cellCount],
  async () => {
    const order = slots.value.map((s) => `${s.uid}:${s.session ? s.session.slice(0, 4) : "-"}`).join(" ");
    dbg(`state expanded=${expandedUid.value} count=${cellCount.value} order=[${order}]`);
    await nextTick();
    const cells = document.querySelectorAll(".cell");
    const headers = [...cells].filter((c) => c.querySelector(".cell-header")).length;
    const main = zoomMain.value?.childElementCount ?? 0;
    const grid = document.querySelector(".grid")?.childElementCount ?? 0;
    dbg(`  dom cells=${cells.length} headers=${headers} zoomMain=${main} gridChildren=${grid}`);
  },
  { deep: true, immediate: true },
);

// While zoomed, push empty cells to the end of the strip so the open terminals line
// up on the left. Pure CSS order — never reorders the DOM.
const stripOrder = (slot: Slot) => (zoomed.value && slot.uid !== expandedUid.value && slot.session === null ? { order: 1 } : undefined);
</script>

<template>
  <div class="stage" :class="{ zoomed }">
    <div ref="zoomMain" class="zoom-main" />
    <div class="grid" :style="gridStyle">
      <Teleport v-for="slot in visibleSlots" :key="slot.uid" :to="zoomMain" :disabled="!(zoomed && slot.uid === expandedUid)">
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
.zoom-main {
  display: none;
}

/* Filmstrip: the zoomed cell (teleported here) fills the top. */
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

/* The grid itself becomes the bottom strip: the remaining cells in a single row
   that scrolls horizontally when they overflow. */
.stage.zoomed .grid {
  flex: 0 0 150px;
  display: flex;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
}
.stage.zoomed .grid > * {
  flex: 0 0 260px;
  height: 100%;
  min-width: 0;
}
</style>
