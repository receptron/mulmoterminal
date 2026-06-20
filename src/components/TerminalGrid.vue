<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import TerminalCell from "./TerminalCell.vue";

// Fixed 2x2 grid. Zooming interface: the grid is the base view; expanding a cell
// grows it to fill the area and shrinks the others to zero — animated by
// transitioning the grid track sizes (Mac-like zoom). All cells stay MOUNTED the
// whole time, so their terminals keep running while another is zoomed.
const COLS = 2;
const CELL_COUNT = 4;
const cells = Array.from({ length: CELL_COUNT }, (_, i) => i);

// The active workspace dir, shown in each cell header. One value for now (server
// global); becomes per-cell once per-terminal dirs land (plan P5).
const cwd = ref<string | null>(null);
onMounted(async () => {
  try {
    const res = await fetch("/api/config");
    if (res.ok) cwd.value = (await res.json()).cwd ?? null;
  } catch {
    // header just omits the dir if config can't be fetched
  }
});

// Persisted so a page reload restores the open terminals (each cell resumes its
// session) and the zoom state.
const STORE_KEY = "grid_state_v1";
// Session ids are UUIDs. Drop anything else from a stale/tampered localStorage so
// a cell never mounts with an invalid id (which the server rejects, leaving the
// terminal reconnecting forever).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function loadState(): { sessions: (string | null)[]; expanded: number | null } {
  const fallback = { sessions: Array<string | null>(CELL_COUNT).fill(null), expanded: null };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const sessions = Array.from({ length: CELL_COUNT }, (_, i) => {
      const v = parsed?.sessions?.[i];
      return typeof v === "string" && UUID_RE.test(v) ? v : null;
    });
    const e = parsed?.expanded;
    const expanded = typeof e === "number" && e >= 0 && e < CELL_COUNT ? e : null;
    return { sessions, expanded };
  } catch {
    return fallback;
  }
}

const initial = loadState();
const cellSessions = ref<(string | null)[]>(initial.sessions);
const expanded = ref<number | null>(initial.expanded);

watch([cellSessions, expanded], () => localStorage.setItem(STORE_KEY, JSON.stringify({ sessions: cellSessions.value, expanded: expanded.value })), {
  deep: true,
});

function toggleExpand(i: number) {
  expanded.value = expanded.value === i ? null : i;
}

function setSession(i: number, id: string | null) {
  cellSessions.value[i] = id;
  // A closed cell can't stay zoomed.
  if (id === null && expanded.value === i) expanded.value = null;
}

// Drive the zoom purely through the grid track template: the expanded cell's
// row/column become 1fr and the others collapse to 0fr. Transitioning these
// (plus the gap) gives the grow/shrink animation.
const trackStyle = computed(() => {
  const e = expanded.value;
  if (e === null) {
    return { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "6px" };
  }
  const axis = (active: number) => [0, 1].map((n) => (n === active ? "1fr" : "0fr")).join(" ");
  return { gridTemplateColumns: axis(e % COLS), gridTemplateRows: axis(Math.floor(e / COLS)), gap: "0px" };
});
</script>

<template>
  <div class="grid" :style="trackStyle">
    <TerminalCell
      v-for="i in cells"
      :key="i"
      :expanded="expanded === i"
      :initial-session-id="cellSessions[i]"
      :cwd="cwd"
      @toggle-expand="toggleExpand(i)"
      @session="(id) => setSession(i, id)"
      @close="() => setSession(i, null)"
    />
  </div>
</template>

<style scoped>
.grid {
  height: 100%;
  width: 100%;
  display: grid;
  padding: 6px;
  background: #0f0f1e;
  box-sizing: border-box;
  /* Mac-like zoom: animate the track sizes (and gap) as a cell expands/restores. */
  transition:
    grid-template-columns 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    grid-template-rows 0.24s cubic-bezier(0.22, 1, 0.36, 1),
    gap 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
</style>
