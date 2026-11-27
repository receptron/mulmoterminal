<script setup lang="ts">
// Reading a conversation room, and speaking in one (#1456).
//
// v2 gave the rooms a file, an API and a CLI, and left the app unable to show them: a table
// finished with "agreed · 4 turns" and the conversation itself — the only thing the feature
// produces — was reachable only by knowing the room id and running `mulmoterminal room read`.
//
// The post box is not a convenience on top of that. It is the half of #1456 that makes a room
// worth having: the agents are typed into by the runner and cannot see each other, so a person
// joining the conversation has to come in from outside, exactly as the CLI and a CI job do. This
// is that door, for the person already looking at the screen.
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useRoomsView, roomsViewSelect } from "../composables/useRoomsView";
import { useEscapeToClose } from "../composables/useEscapeToClose";
import { heldWhileClosed } from "../composables/overlayVisibility";
import { deleteRoom, listRooms, loadRoom, sendRoomMessage } from "../composables/useRooms";
import { relativeTime } from "./cellDisplay";
import type { RoomMessage } from "../../common/roomMessage";
import { useI18n } from "vue-i18n";
import FullScreenOverlay from "./FullScreenOverlay.vue";

const { t } = useI18n();

const POLL_MS = 2000;
const DEFAULT_SPEAKER = "human";
/** How close to the end still counts as "reading the latest". */
const NEAR_BOTTOM_PX = 80;

const view = useRoomsView();
const { isOpen, close } = view;
// Held while closed, so the hidden screen keeps the conversation it showed.
const room = heldWhileClosed(isOpen, () => view.room.value);
useEscapeToClose(isOpen, close);

const rooms = ref<string[]>([]);
const messages = ref<RoomMessage[]>([]);
// Null while nothing has been read yet; a string once a read FAILED. An unreadable room must not
// render as an empty conversation — that is the same mistake the server stopped making in #1476,
// and a person is even less able to tell the two apart than the runner was.
const readError = ref<string | null>(null);
const speaker = ref(DEFAULT_SPEAKER);
const draft = ref("");
const sending = ref(false);
const sendError = ref<string | null>(null);
const now = ref(Date.now());

let pollTimer: ReturnType<typeof setInterval> | null = null;

const empty = computed(() => !readError.value && messages.value.length === 0);

const log = ref<HTMLElement | null>(null);
const readingTheLatest = (): boolean => {
  const el = log.value;
  // No element yet means the first render, which should land at the newest message.
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
};

/** Show the conversation, following it only when the reader is already at the end. A table posts a
 *  turn every couple of minutes, and yanking somebody away from the passage they went back to read
 *  is worse than making them scroll for the new line. */
async function showMessages(next: RoomMessage[]): Promise<void> {
  const follow = readingTheLatest();
  messages.value = next;
  if (!follow) return;
  await nextTick();
  if (log.value) log.value.scrollTop = log.value.scrollHeight;
}

/** The whole room every poll, not the `?since=` tail. Two posts can share a millisecond, so a tail
 *  keyed on the newest timestamp can step over one — and a conversation somebody is reading is
 *  small and on loopback. `since` stays for followers that cannot afford the whole room. */
async function refresh(): Promise<void> {
  const id = room.value;
  if (!id) return;
  const read = await loadRoom(id);
  if (room.value !== id) return; // moved on while the request was in flight
  now.value = Date.now();
  if (!read.ok) {
    readError.value = "Could not read this room.";
    return;
  }
  readError.value = null;
  await showMessages(read.messages);
}

async function refreshRooms(): Promise<void> {
  rooms.value = await listRooms();
}

function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// Which run of the watcher below is the current one. The callback AWAITS before arming the poll,
// so two room changes in quick succession leave an older run suspended: it resumes after the newer
// one has already armed, overwrites `pollTimer`, and the newer timer is then unreachable — two
// intervals polling and only one that can ever be cleared (Codex review on #1456).
let watchRun = 0;

// Poll only while the overlay is open and a room is chosen — a timer left running behind a closed
// overlay is a request every two seconds for as long as the tab lives. Closing keeps the conversation
// on screen for the next opening; only moving to another room clears it.
watch(
  [isOpen, room],
  async ([open, id], previous) => {
    const run = ++watchRun;
    stopPolling();
    if (id !== previous?.[1]) {
      messages.value = [];
      readError.value = null;
      sendError.value = null;
    }
    if (!open) return;
    await Promise.all([refreshRooms(), refresh()]);
    if (run !== watchRun) return; // a newer run took over while this one was in flight
    if (room.value) pollTimer = setInterval(refresh, POLL_MS);
  },
  { immediate: true },
);

onUnmounted(stopPolling);

async function send(): Promise<void> {
  const id = room.value;
  const text = draft.value.trim();
  if (!id || !text || sending.value) return;
  sending.value = true;
  const ok = await sendRoomMessage(id, speaker.value.trim() || DEFAULT_SPEAKER, text);
  sending.value = false;
  // Kept in the box on failure. A post that vanished from the screen without reaching the room is
  // the one outcome a person cannot recover from.
  sendError.value = ok ? null : "Could not post — the message is still here.";
  if (!ok) return;
  draft.value = "";
  await refresh();
}

async function forget(id: string): Promise<void> {
  if (!window.confirm(`Delete the conversation "${id}"? This cannot be undone.`)) return;
  if (!(await deleteRoom(id))) return;
  await refreshRooms();
  if (room.value === id) messages.value = [];
}
</script>

<template>
  <FullScreenOverlay :open="isOpen" :region-label="t('tips.overlays.roomsRegion')" :close-label="t('tips.overlays.closeRooms')" @close="close">
    <template #header>
      <span class="text-[14px] font-[650] text-fg">Rooms</span>
      <span v-if="room" class="truncate font-mono text-[12px] text-dim">{{ room }}</span>
    </template>

    <div class="flex min-h-0 flex-1">
      <nav class="w-[260px] flex-none overflow-y-auto border-r border-border bg-panel p-1" :aria-label="t('tips.overlays.rooms')">
        <p v-if="!rooms.length" class="m-0 px-2 py-2 font-sans text-[12px] text-dim">
          No conversations yet. A round table starts one; so does <span class="font-mono">mulmoterminal room post</span>.
        </p>
        <div v-for="name in rooms" :key="name" class="flex items-center gap-1">
          <button
            type="button"
            data-testid="room-item"
            class="min-w-0 flex-1 cursor-pointer truncate rounded-[4px] border-none px-2 py-1.5 text-left font-mono text-[12px] hover:bg-hover hover:text-fg"
            :class="name === room ? 'bg-hover text-fg' : 'bg-transparent text-secondary'"
            @click="roomsViewSelect(name)"
          >
            {{ name }}
          </button>
          <button
            type="button"
            data-testid="room-delete"
            class="cursor-pointer rounded-[4px] border-none bg-transparent px-1.5 py-1.5 text-[12px] text-dim hover:bg-hover hover:text-err-text"
            :aria-label="t('tips.overlays.deleteRoomAria', { name })"
            :data-tip="t('tips.overlays.deleteRoom')"
            @click="forget(name)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">delete</span>
          </button>
        </div>
      </nav>

      <section class="flex min-w-0 flex-1 flex-col">
        <p v-if="!room" class="m-0 p-4 font-sans text-[13px] text-dim">Pick a conversation.</p>

        <template v-else>
          <div ref="log" class="min-h-0 flex-1 overflow-y-auto p-4">
            <p v-if="readError" data-testid="room-read-error" class="m-0 font-sans text-[13px] text-err-text">{{ readError }}</p>
            <p v-else-if="empty" class="m-0 font-sans text-[13px] text-dim">Nothing has been said in this room yet.</p>
            <!-- An agent's turn runs to hundreds of words, and a line the full width of a 1400px
                 window is unreadable. -->
            <article v-for="(message, index) in messages" :key="`${message.at}-${index}`" data-testid="room-message" class="mb-4 max-w-[90ch]">
              <p class="m-0 mb-1 flex items-baseline gap-2 font-sans text-[12px]">
                <span class="font-[650] text-fg">{{ message.from }}</span>
                <span class="text-dim">{{ relativeTime(message.at, now) }}</span>
              </p>
              <p class="m-0 whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.5] text-secondary">{{ message.text }}</p>
            </article>
          </div>

          <form class="flex flex-none items-start gap-2 border-t border-border bg-panel p-2" @submit.prevent="send">
            <input
              v-model="speaker"
              data-testid="room-speaker"
              :aria-label="t('tips.overlays.roomName')"
              class="w-[90px] flex-none rounded-[4px] border border-border bg-base px-2 py-1.5 font-sans text-[12px] text-fg"
            />
            <!-- Enter sends, Shift+Enter breaks the line: this is a chat box, and a turn here is
                 read by every agent at the table. -->
            <textarea
              v-model="draft"
              data-testid="room-draft"
              rows="2"
              placeholder="Say something to the room…"
              :aria-label="t('tips.overlays.message')"
              class="min-w-0 flex-1 resize-y rounded-[4px] border border-border bg-base px-2 py-1.5 font-mono text-[12px] text-fg"
              @keydown.enter.exact.prevent="send"
            ></textarea>
            <button
              type="submit"
              data-testid="room-send"
              class="flex-none cursor-pointer rounded-[4px] border border-border bg-base px-3 py-1.5 font-sans text-[12px] text-secondary hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-40"
              :disabled="sending || !draft.trim()"
            >
              Send
            </button>
          </form>
          <p v-if="sendError" data-testid="room-send-error" class="m-0 px-3 pb-2 font-sans text-[12px] text-err-text">{{ sendError }}</p>
        </template>
      </section>
    </div>
  </FullScreenOverlay>
</template>
