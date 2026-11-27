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
import { copyOutcomeFor, copyOutcomeMessage, clipboardAvailable } from "./codeBlockCopy";
import { MODAL_FOCUSABLE } from "../utils/focusTrap";
import { modalKeydownHandler } from "../composables/useModalKeyboard";
import type { TerminalAgent } from "../../common/sessionAgent";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

// The caller styles this button — `TerminalCell` passes CELL_BTN, the same class every other
// button in that toolbar row carries — and the class has to reach the BUTTON, not the wrapper.
//
// Two things made that fail silently. The template has two roots (the span and the Teleport), so
// Vue could not auto-inherit at all and dropped the class with a console warning (#1895). And the
// obvious repair — folding the Teleport inside the span for a single root — MEASURED as putting
// the class on the `<span>` instead: the warning goes away and the button stays unstyled, because
// `.cell-btn` is a marker with no CSS rule of its own. So the target is named explicitly here
// rather than left to inheritance, which also means a second root can be added back safely.
defineOptions({ inheritAttrs: false });

// `host`: the remote host the session runs on (#3506), null or absent for this machine.
const props = defineProps<{ sessionId: string; cwd: string | null; agent: TerminalAgent; host?: string | null }>();

const busy = ref(false);
const note = ref<string | null>(null);
// Set when the text could not reach the clipboard and has to be selected by hand.
const manual = ref<string | null>(null);
const box = ref<HTMLTextAreaElement>();
const modalEl = ref<HTMLElement | null>(null);
let noteTimer: ReturnType<typeof setTimeout> | undefined;

// The shared modal keyboard contract, but registered only while the dialog is open — this component
// is always mounted (it is a cell button), so listening for its whole lifetime would swallow Escape
// for everything else.
//
// MODAL_FOCUSABLE rather than the default selector: this dialog's first stop is the `textarea`
// holding the code, and the default list is buttons only — the trap would then wrap Tab onto the
// Close button and the text itself would be unreachable from the keyboard.
const onKeydown = modalKeydownHandler({ modalEl, onClose: () => closeManual(), trapSelector: MODAL_FOCUSABLE });

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
    const turn = await fetchLastTurn({ sessionId: props.sessionId, cwd: props.cwd, agent: props.agent, host: props.host ?? null }, "reply");
    const outcome = copyOutcomeFor(turn);
    if (outcome.kind !== "ok") return flash(copyOutcomeMessage(outcome));
    if (!clipboardAvailable()) return showForManualCopy(outcome.text);
    try {
      await navigator.clipboard.writeText(outcome.text);
      flash(copyOutcomeMessage(outcome));
    } catch {
      // Permission or focus refused it. The text is already in hand, so offer it rather than
      // reporting a failure the user cannot act on.
      void showForManualCopy(outcome.text);
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

// A key, the palette or a configured header button asks for the same copy (#2653).
defineExpose({ copyLastBlock });

function closeManual(): void {
  manual.value = null;
  document.removeEventListener("keydown", onKeydown);
}
</script>

<template>
  <span class="relative inline-flex">
    <button
      v-bind="$attrs"
      type="button"
      class="cell-btn"
      :data-tip="t('tips.panes.copyLastBlock')"
      :aria-label="t('tips.panes.copyLastBlockAria')"
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
        :aria-label="t('tips.panes.copyBlockAria')"
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
