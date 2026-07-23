// @vitest-environment node
//
// The pure rule has its own spec; what is pinned here is the part that actually stops the noise:
// that a CSI handler returning true really does keep xterm out of mouse mode (#729). Asserting the
// rule alone would pass just as happily with the handlers wired to the wrong final byte, or to a
// hook that xterm ignores — and the symptom (coordinates typed into the agent's prompt) would be
// back with nothing red to show for it. Uses the headless terminal: this is parser state, no DOM.
import { describe, it, expect } from "vitest";
import { Terminal } from "@xterm/headless";
import { swallowsMouseTracking } from "../../../src/composables/mouseTrackingModes";

// Mirrors the registration in useTerminalConnections.ensure().
const guard = (term: Terminal) => {
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => swallowsMouseTracking(params));
};

const write = (term: Terminal, data: string) => new Promise<void>((resolve) => term.write(data, resolve));

describe("the mouse-tracking guard on a real terminal", () => {
  // Without the guard xterm enters mouse mode — the state that turns a drag into coordinate
  // reports. If this ever stops being true, the guard below is testing nothing.
  it("would enter mouse mode without the guard", async () => {
    const term = new Terminal();
    await write(term, "\x1b[?1002h");
    expect(term.modes.mouseTrackingMode).toBe("drag");
    term.dispose();
  });

  it.each([
    ["\x1b[?1000h", "click tracking"],
    ["\x1b[?1002h", "drag tracking"],
    ["\x1b[?1003h", "any-motion tracking"],
    ["\x1b[?1002;1006h", "tracking combined with SGR encoding"],
  ])("stays out of mouse mode for %s (%s)", async (sequence) => {
    const term = new Terminal({ allowProposedApi: true });
    guard(term);
    await write(term, sequence);
    expect(term.modes.mouseTrackingMode).toBe("none");
    term.dispose();
  });

  // The guard drops whole sequences, so it must not swallow modes that share the CSI ? form.
  it("still applies an unrelated mode", async () => {
    const term = new Terminal({ allowProposedApi: true });
    guard(term);
    await write(term, "\x1b[?2004h"); // bracketed paste — pasting relies on it
    expect(term.modes.bracketedPasteMode).toBe(true);
    term.dispose();
  });

  it("still applies the reset of an unrelated mode", async () => {
    const term = new Terminal({ allowProposedApi: true });
    guard(term);
    await write(term, "\x1b[?2004h");
    await write(term, "\x1b[?2004l");
    expect(term.modes.bracketedPasteMode).toBe(false);
    term.dispose();
  });

  // Why only SET is refused. Mouse mode can still be turned on by a mixed sequence (honoured
  // above), and if the matching reset were dropped too it could never be turned back off — the
  // terminal would sit in mouse mode for the rest of the session, which is the very state this
  // guard exists to avoid.
  it("lets a reset turn mouse mode back off after a mixed sequence enabled it", async () => {
    const term = new Terminal({ allowProposedApi: true });
    guard(term);
    await write(term, "\x1b[?2004;1002h"); // honoured, so tracking is on
    expect(term.modes.mouseTrackingMode).toBe("drag");
    await write(term, "\x1b[?1002l");
    expect(term.modes.mouseTrackingMode).toBe("none");
    term.dispose();
  });

  // A mixed sequence is honoured rather than dropped: losing the other mode is the worse harm.
  it("honours a sequence that mixes mouse tracking with another mode", async () => {
    const term = new Terminal({ allowProposedApi: true });
    guard(term);
    await write(term, "\x1b[?2004;1002h");
    expect(term.modes.bracketedPasteMode).toBe(true);
    term.dispose();
  });

  // Text still has to render: the guard sits on the same parser the output flows through.
  it("leaves ordinary output untouched", async () => {
    const term = new Terminal({ cols: 20, rows: 2, allowProposedApi: true });
    guard(term);
    await write(term, "hello");
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("hello");
    term.dispose();
  });
});
