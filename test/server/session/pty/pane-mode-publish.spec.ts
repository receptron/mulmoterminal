// @vitest-environment node
// #3299: tmux reports bracketed paste OFF while a pane is in copy-mode, so a reattach made then
// leaves the browser without mode 2004, and leaving copy-mode never turns it back on. Leaving must
// resync it from tmux, or a multi-line paste reaches the program as bare CRs.
import { describe, it, expect } from "vitest";
import { createPaneModePublisher } from "../../../../server/session/pty/pane-mode-publish.js";
import { bracketedPasteSequence } from "../../../../server/session/pty/terminal-replay.js";

const ESC = String.fromCharCode(0x1b);
const PASTE_ON = `${ESC}[?2004h`;
const PASTE_OFF = `${ESC}[?2004l`;

function setup(pasteOn: boolean | null, { open = true, queued = "" } = {}) {
  const frames: Array<{ type: string; data?: string; inCopyMode?: boolean }> = [];
  const asked: string[] = [];
  const ws = { readyState: open ? 1 : 3, OPEN: 1, send: (data: string) => frames.push(JSON.parse(data)), close: () => undefined };
  // Stands in for the output relay holding a batch its timer has not sent yet.
  const pending = queued ? [queued] : [];
  const output = { flush: () => pending.splice(0).forEach((data) => ws.send(JSON.stringify({ type: "output", data }))) };
  const entry = { ws, output };
  const publish = createPaneModePublisher({
    entryOf: () => entry,
    bracketedPasteOf: (id) => {
      asked.push(id);
      return pasteOn;
    },
  });
  return { publish, frames, asked };
}

describe("createPaneModePublisher", () => {
  it("turns bracketed paste back on when the pane leaves copy-mode with it on", () => {
    const { publish, frames } = setup(true);
    publish("s-1", false);
    expect(frames).toEqual([
      { type: "paneMode", inCopyMode: false },
      { type: "output", data: PASTE_ON },
    ]);
  });

  it("turns it off when the program has it off, so the browser cannot keep a stale on", () => {
    const { publish, frames } = setup(false);
    publish("s-1", false);
    expect(frames).toEqual([
      { type: "paneMode", inCopyMode: false },
      { type: "output", data: PASTE_OFF },
    ]);
  });

  // An unreadable flag (a failed query, a tmux without the variable) is not "off".
  it("leaves the mode alone when tmux cannot say", () => {
    const { publish, frames } = setup(null);
    publish("s-1", false);
    expect(frames).toEqual([{ type: "paneMode", inCopyMode: false }]);
  });

  // Output queued before tmux was asked must not land after the answer and undo it.
  it("sends queued program output before its answer", () => {
    const { publish, frames } = setup(true, { queued: `text${PASTE_OFF}` });
    publish("s-1", false);
    expect(frames).toEqual([
      { type: "output", data: `text${PASTE_OFF}` },
      { type: "paneMode", inCopyMode: false },
      { type: "output", data: PASTE_ON },
    ]);
  });

  // In copy-mode tmux says 2004 is off whatever the program set, so asking then would be wrong.
  it("neither asks tmux nor touches the mode on the way INTO copy-mode", () => {
    const { publish, frames, asked } = setup(true);
    publish("s-1", true);
    expect(frames).toEqual([{ type: "paneMode", inCopyMode: true }]);
    expect(asked).toEqual([]);
  });

  it("does nothing, and asks nothing, without an open socket", () => {
    const { publish, frames, asked } = setup(true, { open: false });
    publish("s-1", false);
    expect(frames).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("bracketedPasteSequence", () => {
  it.each([
    { on: true, sequence: PASTE_ON },
    { on: false, sequence: PASTE_OFF },
  ])("$on → $sequence", ({ on, sequence }) => {
    expect(bracketedPasteSequence(on)).toBe(sequence);
  });
});
