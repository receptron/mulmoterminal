<script setup lang="ts">
// "Copy the last code block" for a cell (#865). The agent fences the part meant for Discord or
// Slack; selecting it off the terminal instead drags xterm's own padding along, which is what
// breaks the paste at the far end. So the text comes from the agent's transcript, never the
// screen.
//
// Reuses the handoff read whole (#550): `fetchLastTurn(..., "reply")` already returns the raw
// markdown, already handles codex as well as Claude, and already times out. Nothing new on the
// server — only the fence extraction and this entry point are new.
import { ref, onUnmounted } from "vue";
import { fetchLastTurn } from "../composables/useHandoff";
import { copyOutcomeFor, copyOutcomeMessage, clipboardAvailable, turnOf } from "./codeBlockCopy";
import { trapTabKey, MODAL_FOCUSABLE } from "../utils/focusTrap";
import type { TerminalAgent } from "../../common/sessionAgent";

const props = defineProps<{ sessionId: string; cwd: string | null; agent: TerminalAgent }>();

const busy = ref(false);
const note = ref<string | null>(null);
// Set when the text could not reach the clipboard and has to be selected by hand.
const manual = ref<string | null>(null);
const box = ref<HTMLTextAreaElement>();
const modalEl = ref<HTMLElement | null>(null);
let noteTimer: ReturnType<typeof setTimeout> | undefined;

const flash = (message: string): void => {
  note.value = message;
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => (note.value = null), 2500);
};
onUnmounted(() => {
  if (noteTimer) clearTimeout(noteTimer);
  document.removeEventListener("keydown", onKeydown);
});

async function copyLastBlock(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const turn = await fetchLastTurn({ sessionId: props.sessionId, cwd: props.cwd, agent: props.agent }, "reply");
    const outcome = copyOutcomeFor(turnOf(turn));
    if (outcome.kind !== "ok") return flash(copyOutcomeMessage(outcome));
    if (!clipboardAvailable()) return showForManualCopy(outcome.text);
    try {
      await navigator.clipboard.writeText(outcome.text);
      flash(copyOutcomeMessage(outcome));
    } catch {
      // Permission or focus refused it. The text is already in hand, so offer it rather than
      // reporting a failure the user cannot act on.
      showForManualCopy(outcome.text);
    }
  } catch {
    flash("Could not read this session's last turn");
  } finally {
    busy.value = false;
  }
}

// Over plain http:// — which is how the phone and a second machine reach this app — there is no
// Clipboard API at all, and "paste it into another app" is exactly what those users came for.
async function showForManualCopy(text: string): Promise<void> {
  manual.value = text;
  document.addEventListener("keydown", onKeydown);
  await new Promise((r) => requestAnimationFrame(r));
  // Focus AND select: the whole point of this dialog is that the text is ready to copy with
  // one key, or one long-press on a phone.
  box.value?.focus();
  box.value?.select();
}

// Modal keyboard behavior, same as TimelineOverlay and SettingsModal: Escape closes, Tab stays
// inside. On the document rather than the dialog element — bound to the element it would only
// fire while focus is already inside, so one click on the backdrop would kill Escape. Registered
// only while open so it cannot swallow either key for anything else.
//
// MODAL_FOCUSABLE rather than the default selector: this dialog's first stop is the `textarea`
// holding the code, and the default list is buttons only — the trap would then wrap Tab onto the
// Close button and the text itself would be unreachable from the keyboard.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    closeManual();
    return;
  }
  if (e.key !== "Tab" || !modalEl.value) return;
  trapTabKey(e, modalEl.value, MODAL_FOCUSABLE);
}

function closeManual(): void {
  manual.value = null;
  document.removeEventListener("keydown", onKeydown);
}
</script>

<template>
  <span class="relative inline-flex">
    <button
      type="button"
      class="cell-btn"
      title="Copy the last code block from this session's latest reply"
      aria-label="Copy the last code block"
      :disabled="busy"
      @click="copyLastBlock"
    >
      <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
    </button>
    <span
      v-if="note"
      role="status"
      class="pointer-events-none absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-md border border-border bg-panel px-2 py-1 text-[11px] text-fg shadow-[0_6px_18px_rgba(0,0,0,0.35)]"
      >{{ note }}</span
    >
  </span>

  <!-- Teleported for the same reason TimelineOverlay is (#968): a focused cell is scaled with
       `transform`, which would make this `fixed` root take the cell's rect instead of the
       viewport's. -->
  <Teleport to="body">
    <div v-if="manual !== null" class="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.45)]" @click.self="closeManual">
      <div
        ref="modalEl"
        class="flex max-h-[80vh] w-[min(640px,92vw)] flex-col gap-2 rounded-lg bg-panel p-4 text-fg shadow-[0_10px_40px_rgba(0,0,0,0.5)]"
        role="dialog"
        aria-modal="true"
        aria-label="Copy the code block"
        tabindex="-1"
      >
        <p class="text-[12px] text-muted">
          Your browser blocks clipboard access on this address — it is available only over https or localhost. The block is selected below; copy it with your
          usual key or long-press.
        </p>
        <textarea
          ref="box"
          readonly
          data-testid="copy-block-text"
          class="h-[50vh] w-full resize-none rounded border border-border bg-deep p-2 font-mono text-[12px] text-fg"
          :value="manual"
        />
        <button type="button" class="self-end rounded border border-border px-3 py-1 text-[12px] hover:bg-hover" @click="closeManual">Close</button>
      </div>
    </div>
  </Teleport>
</template>
