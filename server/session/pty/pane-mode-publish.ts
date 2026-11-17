// What the browser is told when a tmux pane enters or leaves copy-mode.
//
// Leaving it must also resync bracketed paste (#3299). While a pane is in copy-mode tmux reports
// `bracket_paste_flag` as 0, so a reattach made then restores the browser WITHOUT mode 2004 — and
// leaving copy-mode emits nothing that turns it back on. A multi-line paste then reaches the
// program as bare CRs, each one a submit.
import { sendFrame, type FrameSocket } from "../ws-frames.js";
import type { OutputRelay } from "./output-relay.js";
import { bracketedPasteSequence } from "./terminal-replay.js";

export interface PaneModeTarget {
  ws: FrameSocket | null;
  output?: Pick<OutputRelay, "flush">;
}

export interface PaneModePublishDeps {
  entryOf: (id: string) => PaneModeTarget | undefined;
  /** The program's bracketed paste as tmux sees it, or null when tmux cannot say. */
  bracketedPasteOf: (id: string) => boolean | null;
}

export function createPaneModePublisher(deps: PaneModePublishDeps) {
  return (id: string, inCopyMode: boolean): void => {
    const entry = deps.entryOf(id);
    if (!entry) return;
    // Queued output goes first: it was written before tmux is asked, and a 2004 set or reset in it
    // landing after our answer would undo it.
    entry.output?.flush();
    if (!sendFrame(entry.ws, { type: "paneMode", inCopyMode }) || inCopyMode) return;
    const pasteOn = deps.bracketedPasteOf(id);
    if (pasteOn !== null) sendFrame(entry.ws, { type: "output", data: bracketedPasteSequence(pasteOn) });
  };
}
