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

function setup(modes: readonly number[], open = true) {
  const frames: unknown[] = [];
  const asked: string[] = [];
  const socket = { readyState: open ? 1 : 3, OPEN: 1, send: (data: string) => frames.push(JSON.parse(data)), close: () => undefined };
  const publish = createPaneModePublisher({
    socketOf: () => socket,
    terminalModesOf: (id) => {
      asked.push(id);
      return modes;
    },
  });
  return { publish, frames, asked };
}

describe("createPaneModePublisher", () => {
  it("turns bracketed paste back on when the pane leaves copy-mode with it on", () => {
    const { publish, frames } = setup([1049, 2004]);
    publish("s-1", false);
    expect(frames).toEqual([
      { type: "paneMode", inCopyMode: false },
      { type: "output", data: PASTE_ON },
    ]);
  });

  it("turns it off when the program has it off, so the browser cannot keep a stale on", () => {
    const { publish, frames } = setup([1049]);
    publish("s-1", false);
    expect(frames).toEqual([
      { type: "paneMode", inCopyMode: false },
      { type: "output", data: PASTE_OFF },
    ]);
  });

  // In copy-mode tmux says 2004 is off whatever the program set, so asking then would be wrong.
  it("neither asks tmux nor touches the mode on the way INTO copy-mode", () => {
    const { publish, frames, asked } = setup([2004]);
    publish("s-1", true);
    expect(frames).toEqual([{ type: "paneMode", inCopyMode: true }]);
    expect(asked).toEqual([]);
  });

  it("does nothing, and asks nothing, without an open socket", () => {
    const { publish, frames, asked } = setup([2004], false);
    publish("s-1", false);
    expect(frames).toEqual([]);
    expect(asked).toEqual([]);
  });
});

describe("bracketedPasteSequence", () => {
  it.each([
    { modes: [2004], sequence: PASTE_ON },
    { modes: [1049, 1000, 1006, 2004], sequence: PASTE_ON },
    { modes: [], sequence: PASTE_OFF },
    { modes: [1049, 1000, 1006], sequence: PASTE_OFF },
    { modes: [20040, 204], sequence: PASTE_OFF },
  ])("$modes → $sequence", ({ modes, sequence }) => {
    expect(bracketedPasteSequence(modes)).toBe(sequence);
  });
});
