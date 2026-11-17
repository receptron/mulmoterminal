// What the browser is told when a tmux pane enters or leaves copy-mode.
//
// Leaving it must also resync bracketed paste (#3299). While a pane is in copy-mode tmux reports
// `bracket_paste_flag` as 0, so a reattach made then restores the browser WITHOUT mode 2004 — and
// leaving copy-mode emits nothing that turns it back on. A multi-line paste then reaches the
// program as bare CRs, each one a submit. Asking tmux again once the pane is out is the same
// source the reattach prefix reads, so the two cannot disagree.
import { sendFrame, type FrameSocket } from "../ws-frames.js";
import { bracketedPasteSequence } from "./terminal-replay.js";

export interface PaneModePublishDeps {
  socketOf: (id: string) => FrameSocket | null | undefined;
  terminalModesOf: (id: string) => readonly number[];
}

export function createPaneModePublisher(deps: PaneModePublishDeps) {
  return (id: string, inCopyMode: boolean): void => {
    const socket = deps.socketOf(id);
    if (!sendFrame(socket, { type: "paneMode", inCopyMode }) || inCopyMode) return;
    sendFrame(socket, { type: "output", data: bracketedPasteSequence(deps.terminalModesOf(id)) });
  };
}
