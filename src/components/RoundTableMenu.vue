<script setup lang="ts">
// Picking who sits at a round table, and how long it may run (#1456).
//
// Its own component rather than more markup in TerminalCell: the cell's handoff menu offers ONE
// action per target (bring that turn here / exchange with it), and a table is the opposite shape —
// several targets chosen together before anything happens. Keeping the multi-select here also
// keeps TerminalCell, already the largest component in the app, from growing a second menu.
//
// The picker is the whole admission control for this feature. Agents cannot see each other, join
// anything, or start a table; a human ticks the seats and presses the button. That is why the
// runner needs no MCP tool at all (see useRoundTable).
import { computed, onMounted, ref } from "vue";
import type { HandoffTarget } from "../composables/useHandoff";
import { DEFAULT_TURN_BUDGET, MAX_MEMBERS, TURN_BUDGETS, canRunTable, newRoomId, roomForTable } from "../composables/roundTableRules";
import { listRooms } from "../composables/useRooms";
import { roomsViewOpen } from "../composables/useRoomsView";

const props = defineProps<{
  /** The other readable cells, exactly as the handoff menu lists them. */
  targets: readonly HandoffTarget[];
  /** How this cell is named at the table it starts. */
  selfLabel: string;
  /** A table started from THIS cell is running — the picker offers Stop rather than Start. */
  running: boolean;
  /** The room the running table writes to, so it can be watched while it runs. */
  room: string | null;
  /** SOME automation is running (this table, or the one-turn exchange beside it). Only one may
   *  type into terminals at a time, so Start is refused — but the button stays a Start, because
   *  stopping is the other control's job. */
  busy: boolean;
}>();

const emit = defineEmits<{
  start: [targets: HandoffTarget[], budget: number, room: string];
  stop: [];
}>();

const picked = ref<string[]>([]);
const budget = ref<number>(DEFAULT_TURN_BUDGET);

// Which room to talk in. Empty mints a new one — the same thing every table did before this box
// existed, so the default behaviour is unchanged and the box is opt-in.
const roomName = ref("");
const knownRooms = ref<string[]>([]);
// Only ever mounted while the ask menu is open, so this is one request per time the user looks.
onMounted(async () => {
  knownRooms.value = await listRooms();
});

const chosenRoom = computed(() => roomForTable(roomName.value, newRoomId));
const roomRejected = computed(() => chosenRoom.value === null);

const isPicked = (key: string): boolean => picked.value.includes(key);

// The cap counts the starting cell, which is always a seat — so the user may tick one fewer than
// the table holds. Ticking past it is refused here rather than trimmed at the start: a seat that
// silently did not join is worse than a checkbox that will not tick.
const full = computed(() => picked.value.length + 1 >= MAX_MEMBERS);

function toggle(key: string): void {
  if (isPicked(key)) picked.value = picked.value.filter((k) => k !== key);
  else if (!full.value) picked.value = [...picked.value, key];
}

const seats = computed(() => picked.value.length + 1);
const ready = computed(() => !props.busy && canRunTable(seats.value) && !roomRejected.value);

function start(): void {
  const room = chosenRoom.value;
  const chosen = props.targets.filter((target) => isPicked(target.key));
  if (room && chosen.length) emit("start", [...chosen], budget.value, room);
}
</script>

<template>
  <!-- `min-h-0` so this whole block can shrink inside the bounded menu that holds it; the seat
       list below is what actually gives way, and the controls under it never do (#2003). -->
  <div data-testid="round-table" class="mt-1 flex min-h-0 flex-col gap-1 border-t border-border pt-1">
    <p class="m-0 flex-none px-2 py-0.5 font-sans text-[11px] uppercase tracking-[0.04em] text-dim">Round table</p>

    <!-- One seat per other terminal, so this grows with the grid exactly as the list above it
         does — 19 of them on a 20-cell grid. It scrolls; turns, room and Start do not. -->
    <!-- `min-h-[2.5rem]` (about one row) so this cannot shrink to nothing. `min-h-0` alone let it
         collapse to 0px in a short menu — measured — and a seat list with no height means no seat
         can be ticked, which leaves Start disabled however reachable it is. Codex caught that the
         first sweep only checked Start. The floor makes the menu overflow sooner instead, and the
         container scrolls. -->
    <div data-testid="round-table-seats" class="flex min-h-[2.5rem] flex-col gap-1 overflow-y-auto">
      <label
        v-for="target in targets"
        :key="target.key"
        class="flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2 py-1 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg"
        :class="{ 'cursor-default opacity-40': busy || (full && !isPicked(target.key)) }"
      >
        <input
          type="checkbox"
          data-testid="round-table-seat"
          class="m-0 cursor-pointer"
          :value="target.key"
          :checked="isPicked(target.key)"
          :disabled="busy || (full && !isPicked(target.key))"
          @change="toggle(target.key)"
        />
        {{ target.label }}
      </label>
    </div>

    <label class="flex flex-none items-center gap-1.5 px-2 py-1 font-sans text-[12px] text-secondary">
      turns
      <select
        v-model.number="budget"
        data-testid="round-table-budget"
        :disabled="busy"
        class="cursor-pointer rounded-[4px] border border-border bg-panel px-1 py-0.5 text-[12px] text-fg"
      >
        <option v-for="option in TURN_BUDGETS" :key="option" :value="option">{{ option }}</option>
      </select>
      <!-- Every turn is a real agent turn on a real account, so the count is a cost as much as a
           runaway guard. Saying so beside the number is cheaper than finding out afterwards. -->
      <span class="text-dim">· {{ seats }} seats, one turn each in order</span>
    </label>

    <label class="flex flex-none items-center gap-1.5 px-2 py-1 font-sans text-[12px] text-secondary">
      room
      <input
        v-model="roomName"
        data-testid="round-table-room"
        list="round-table-rooms"
        placeholder="new room"
        :disabled="busy"
        class="w-[130px] rounded-[4px] border bg-panel px-1 py-0.5 text-[12px] text-fg"
        :class="roomRejected ? 'border-err-text' : 'border-border'"
        title="Leave empty for a new room. Naming an existing one continues that conversation."
      />
      <datalist id="round-table-rooms">
        <option v-for="known in knownRooms" :key="known" :value="known" />
      </datalist>
    </label>
    <p v-if="roomRejected" data-testid="round-table-room-error" class="m-0 flex-none px-2 pb-1 font-sans text-[11px] text-err-text">
      lowercase letters, digits and - only
    </p>

    <button
      v-if="!running"
      type="button"
      data-testid="round-table-start"
      class="mx-1 mb-1 flex-none cursor-pointer rounded-[4px] border border-border bg-transparent px-2 py-1 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40"
      :disabled="!ready"
      :title="busy ? 'Another automation is running in this cell' : ready ? `Start a table of ${seats}, ${budget} turns` : 'Pick at least one other terminal'"
      @click="start"
    >
      <span class="material-symbols-outlined align-middle" aria-hidden="true">groups</span>
      Start · {{ selfLabel }} first
    </button>
    <button
      v-else
      type="button"
      data-testid="round-table-stop"
      class="mx-1 flex-none cursor-pointer rounded-[4px] border border-border bg-transparent px-2 py-1 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg"
      @click="emit('stop')"
    >
      <span class="material-symbols-outlined align-middle" aria-hidden="true">groups</span>
      running — stop
    </button>

    <!-- Shown while the table runs AND after it ends: the conversation is the whole product of a
         table, and a link that vanished the moment it finished would hide it exactly when there is
         finally something to read. Until this existed, reading it meant knowing the room id and
         running the CLI. -->
    <button
      v-if="room"
      type="button"
      data-testid="round-table-watch"
      class="mx-1 mb-1 flex-none cursor-pointer truncate rounded-[4px] border-none bg-transparent px-2 py-1 text-left font-sans text-[12px] text-dim hover:text-fg"
      :title="`Read ${room}`"
      @click="roomsViewOpen(room)"
    >
      <span class="material-symbols-outlined align-middle" aria-hidden="true">forum</span>
      {{ running ? "watch the conversation" : "read the conversation" }}
    </button>
  </div>
</template>
