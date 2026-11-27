// The terminal's custom key handler must hand an IME-confirming key back to xterm rather than
// turning it into bytes for the pty (#1353).
//
// `esc-cr` mode is deliberate: it is the mode where a BARE Enter is intercepted, so an unguarded
// confirmation submits the half-converted line to the agent. In the default `cr` mode a bare Enter
// is already left native, which is why this never showed up there.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { termState: mockTermState, keyState: mockKeyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());

vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(mockTermState, mockKeyState));
vi.mock("@xterm/addon-fit", async () => (await import("../../helpers/xtermDouble")).fitAddonModule());
vi.mock("@xterm/addon-web-links", async () => (await import("../../helpers/xtermDouble")).webLinksAddonModule());
vi.mock("@xterm/addon-clipboard", async () => (await import("../../helpers/xtermDouble")).clipboardAddonModule());
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import * as conn from "../../../src/composables/useTerminalConnections";
import { FakeWebSocket } from "../../helpers/xtermDouble";
import { submitSequence } from "../../../common/terminalSubmit";
import { setTerminalSubmitMode } from "../../../src/composables/terminalSubmitMode";
import { resetImeComposition } from "../../../src/composables/imeComposition";

const target = { sessionId: null, cwd: "/typed", devTerminal: false, command: null, launcher: null };
const bareEnter = (isComposing = false) => ({
  type: "keydown",
  key: "Enter",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  isComposing,
  preventDefault: vi.fn(),
});

const fire = (type: "compositionstart" | "compositionend") => window.dispatchEvent(new Event(type));

/** A connected slot in esc-cr mode, plus the socket its bytes would go to. */
function connectEscCr() {
  mockKeyState.handler = () => true;
  setTerminalSubmitMode("esc-cr");
  conn.attach("cell-ime", target, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no socket created");
  ws.onopen?.();
  ws.sent.length = 0;
  return ws;
}

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  resetImeComposition();
});
afterEach(() => {
  conn.release("cell-ime");
  resetImeComposition();
  setTerminalSubmitMode("cr");
});

describe("terminal keys during an IME composition", () => {
  // The control. Without it the guard tests below would pass against a handler that never sends.
  it("submits a bare Enter in esc-cr mode when no IME is involved", () => {
    const ws = connectEscCr();

    expect(mockKeyState.handler(bareEnter())).toBe(false); // claimed
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));
  });

  // Chrome / Firefox: the flag is still set on the confirming keydown.
  it("sends nothing when the event itself is still composing", () => {
    const ws = connectEscCr();

    expect(mockKeyState.handler(bareEnter(true))).toBe(true); // handed back to xterm
    expect(ws.sent).toEqual([]);
  });

  // Safari: compositionend has already fired, so `isComposing` is false — the case the four
  // existing `isComposing` guards could not see.
  it("sends nothing on the keydown that immediately follows compositionend", () => {
    const ws = connectEscCr();

    fire("compositionstart");
    fire("compositionend");

    expect(mockKeyState.handler(bareEnter(false))).toBe(true);
    expect(ws.sent).toEqual([]);
  });

  it("sends nothing while a composition is still open", () => {
    const ws = connectEscCr();

    fire("compositionstart");

    expect(mockKeyState.handler(bareEnter(false))).toBe(true);
    expect(ws.sent).toEqual([]);
  });

  // xtermjs/xterm.js#6244: xterm would commit the text on this keydown AND on compositionend.
  // `false` is what stops xterm before its composition helper ever sees the key.
  it("withholds a bare Meta keydown during a composition from xterm", () => {
    const ws = connectEscCr();

    expect(mockKeyState.handler({ ...bareEnter(true), key: "Meta", metaKey: true })).toBe(false);
    expect(ws.sent).toEqual([]);
  });

  it("still hands a Meta keydown outside a composition to xterm", () => {
    connectEscCr();

    expect(mockKeyState.handler({ ...bareEnter(false), key: "Meta", metaKey: true })).toBe(true);
  });
});
