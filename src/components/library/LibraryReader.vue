<script setup lang="ts">
// One conversation, read (#3329): its title, one grey line of facts — including the cost and the
// lines it changed, which the list leaves out — and the conversation itself, through the same
// transcript view the terminal's side pane uses.
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import TranscriptPane from "../TranscriptPane.vue";
import { LIBRARY_NAME_MAX, type LibraryConversation } from "../../../common/library";
import { costLabel, metaParts } from "./libraryRows";

const props = defineProps<{ conversation: LibraryConversation; now: number; notice: string | null; name: string | null; pinned: boolean }>();
const emit = defineEmits<{ resume: []; pin: [pinned: boolean]; rename: [id: string, name: string | null] }>();
const { t, locale } = useI18n();

const menuOpen = ref(false);
/** The name being typed, or null while not renaming. */
const draft = ref<string | null>(null);
const nameField = ref<HTMLInputElement | null>(null);
const shownTitle = computed(() => props.name ?? props.conversation.title ?? t("libraryView.untitled"));

/** The conversation the rename was started on: the name is saved for it, whatever is selected by then. */
let renaming: string | null = null;
// Another conversation chosen mid-rename or with the menu open: both belong to the one left behind.
watch(
  () => props.conversation.id,
  () => {
    draft.value = null;
    renaming = null;
    menuOpen.value = false;
  },
);

async function startRename(): Promise<void> {
  menuOpen.value = false;
  renaming = props.conversation.id;
  draft.value = props.name ?? props.conversation.title ?? "";
  await nextTick();
  nameField.value?.select();
}
/** Enter while an input method is composing confirms the conversion, not the name. */
function onRenameEnter(event: KeyboardEvent): void {
  if (event.isComposing) return;
  event.preventDefault();
  finishRename();
}

function finishRename(): void {
  if (draft.value === null || renaming === null) return;
  // The agent's own title back: an empty name, or one identical to it, clears the user's.
  const typed = draft.value.trim();
  emit("rename", renaming, typed === "" || typed === props.conversation.title ? null : typed);
  draft.value = null;
  renaming = null;
}
const menu = ref<HTMLElement | null>(null);
// While the menu is open, Esc and a click elsewhere close IT. Esc is caught on the way down
// (capture), before the Library's own window-level Esc would close the whole screen.
const menuButton = ref<HTMLButtonElement | null>(null);
function onMenuKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  event.preventDefault();
  menuOpen.value = false;
  menuButton.value?.focus(); // back where the keyboard came from, not to the page
}
/** The menu's own keys: the arrows move between its items, and Tab leaves it (closing it). */
function onMenuItemsKey(event: KeyboardEvent): void {
  const items = [...(menu.value?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  const at = items.findIndex((item) => item === document.activeElement);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation(); // the Library's arrows move its list, not this menu
    const next = (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  } else if (event.key === "Tab") {
    menuOpen.value = false;
  }
}
function onMenuFocusOut(event: FocusEvent): void {
  if (event.relatedTarget instanceof Node && menu.value?.contains(event.relatedTarget)) return;
  if (event.relatedTarget !== null) menuOpen.value = false; // focus went somewhere else on the page
}

function onOutsidePointer(event: PointerEvent): void {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return;
  menuOpen.value = false;
}
watch(menuOpen, async (open) => {
  window.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("pointerdown", onOutsidePointer, true);
  if (!open) return;
  window.addEventListener("keydown", onMenuKey, true);
  window.addEventListener("pointerdown", onOutsidePointer, true);
  await nextTick();
  menu.value?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("pointerdown", onOutsidePointer, true);
});

function pickPin(): void {
  menuOpen.value = false;
  emit("pin", !props.pinned);
}

const facts = computed(() => {
  const parts = metaParts(props.conversation, props.now, locale.value);
  const cost = costLabel(props.conversation.costUsd, locale.value);
  return cost === null ? parts : [...parts, cost];
});
const lines = computed(() => {
  const { linesAdded, linesRemoved } = props.conversation;
  return linesAdded === null && linesRemoved === null ? null : { added: linesAdded ?? 0, removed: linesRemoved ?? 0 };
});
</script>

<template>
  <article class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="library-reader">
    <header class="px-4 pb-2 pt-5">
      <!-- Esc here ends the rename, not the Library: the overlay closes on a window-level Esc. -->
      <input
        v-if="draft !== null"
        ref="nameField"
        v-model="draft"
        data-testid="library-rename"
        :aria-label="t('libraryView.rename')"
        :maxlength="LIBRARY_NAME_MAX"
        class="w-full rounded border border-accent bg-base px-2 py-1 font-sans text-[20px] font-[650] text-fg outline-none"
        @keydown.enter.stop="onRenameEnter"
        @keydown.esc.stop.prevent="draft = null"
        @blur="finishRename"
      />
      <h2 v-else class="m-0 flex items-center gap-2 text-balance font-sans text-[20px] font-[650] text-fg">
        <span v-if="pinned" class="material-symbols-outlined text-[18px] text-dim" :aria-label="t('libraryView.groups.pinned')">push_pin</span>
        {{ shownTitle }}
      </h2>
      <p class="m-0 mt-1 flex flex-wrap gap-x-3 font-sans text-[12px] text-dim">
        <span v-for="fact in facts" :key="fact">{{ fact }}</span>
        <span v-if="lines" class="font-mono"
          ><span class="text-ok">+{{ lines.added }}</span> <span class="text-err-text">−{{ lines.removed }}</span></span
        >
      </p>
    </header>
    <div class="flex min-h-0 flex-1">
      <TranscriptPane :key="conversation.id" :session-id="conversation.id" :cwd="conversation.cwd" :agent="conversation.agent" embedded />
    </div>
    <!-- A row of its own rather than floating over the conversation, so the last lines are never under
         it; the notice wraps beside the button and drops above it when the row is narrow. -->
    <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-2">
      <div ref="menu" class="relative mr-auto">
        <button
          ref="menuButton"
          type="button"
          data-testid="library-more-actions"
          class="flex cursor-pointer items-center rounded border-0 bg-transparent p-1 text-secondary hover:bg-hover hover:text-fg"
          :aria-label="t('libraryView.moreActions')"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <span class="material-symbols-outlined text-[20px]">more_horiz</span>
        </button>
        <div
          v-if="menuOpen"
          role="menu"
          class="absolute bottom-full left-0 mb-1 min-w-[12rem] rounded-[6px] border border-border bg-panel py-1 shadow-lg"
          @keydown="onMenuItemsKey"
          @focusout="onMenuFocusOut"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="library-pin"
            class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-sans text-[13px] text-fg hover:bg-hover"
            @click="pickPin"
          >
            <span class="material-symbols-outlined text-[18px]">push_pin</span>{{ t(pinned ? "libraryView.unpin" : "libraryView.pin") }}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="library-rename-start"
            class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left font-sans text-[13px] text-fg hover:bg-hover"
            @click="startRename"
          >
            <span class="material-symbols-outlined text-[18px]">edit</span>{{ t("libraryView.rename") }}
          </button>
        </div>
      </div>
      <span v-if="notice" class="min-w-0 max-w-[44ch] flex-1 basis-[16rem] font-sans text-[12px] text-secondary" role="status">{{ notice }}</span>
      <button
        type="button"
        data-testid="library-resume"
        class="flex flex-none cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-accent px-4 py-2 font-sans text-[13px] font-semibold text-on-accent"
        @click="emit('resume')"
      >
        <span class="material-symbols-outlined text-[18px]">play_arrow</span>
        {{ t("libraryView.resume") }}
        <kbd class="rounded border border-on-accent/40 px-1 font-sans text-[11px] font-normal">Enter</kbd>
      </button>
    </footer>
  </article>
</template>
