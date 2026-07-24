import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the key handler ensure() registers, so a test can drive it and assert the
// real wiring (send + suppress-default) — hoisted so the mock factory can write to it.
// Defaults to a no-op that returns true, so a test that forgot to attach would see the
// pass-through behavior (and thus fail the Shift+Enter assertion) rather than crash.
const mockKeyState: { handler: (e: unknown) => boolean } = vi.hoisted(() => ({ handler: () => true }));
// The options ensure() passes to `new Terminal({...})`, captured for assertions.
const mockTermState: { options: Record<string, unknown>; csiHandlers: unknown[][] } = vi.hoisted(() => ({ options: {}, csiHandlers: [] }));

// Mock xterm + addons so the manager runs headless (no real DOM terminal / canvas).
// Factories are hoisted above imports, so the fakes are declared INSIDE them.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    constructor(opts: Record<string, unknown>) {
      mockTermState.options = opts;
    }
    // ensure() registers the mouse-tracking guards through this (#729); the guards' own behaviour
    // is covered against a REAL terminal in mouseTrackingGuard.spec.ts.
    parser = { registerCsiHandler: (...args: unknown[]) => mockTermState.csiHandlers.push(args) };
    loadAddon() {}
    open() {}
    onData() {}
    attachCustomKeyEventHandler(fn: (e: unknown) => boolean) {
      mockKeyState.handler = fn;
    }
    attachCustomWheelEventHandler() {}
    write() {}
    reset() {}
    focus() {}
    scrollToBottom() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
  },
}));
vi.mock("@xterm/addon-clipboard", () => ({
  ClipboardAddon: class {
    activate() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

// A WebSocket double the test drives by hand (fire onopen / onmessage when it wants).
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static readonly instances: FakeWebSocket[] = [];
  url: string;
  readyState = FakeWebSocket.OPEN; // treat as open immediately for send() guards
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

import * as conn from "../../../src/composables/useTerminalConnections";

const target = (sessionId: string | null) => ({ sessionId, cwd: "/typed", devTerminal: false, command: null, launcher: null });

describe("useTerminalConnections — detached-slot state replay", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
  afterEach(() => {
    conn.release("cell-race"); // tear the slot down so it can't leak into the next test
  });

  it("replays a session id learned WHILE DETACHED to the handlers bound on reattach", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1); // fresh launch, no id yet
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();

    // User navigates away BEFORE the server reports the session id.
    conn.detach("cell-race", el1);
    expect(conn.connView.get("cell-race")).toBeTruthy(); // socket/slot still alive

    // Server NOW assigns the id + resolves the cwd — handlers are detached, so the
    // first view's callbacks must NOT fire (it's gone).
    ws.onmessage?.({ data: JSON.stringify({ type: "session", id: "sess-123", cwd: "/resolved" }) });
    expect(first.onSession).not.toHaveBeenCalled();

    // Coming back must catch the parent up: the freshly-bound handlers receive the
    // id/cwd that arrived while detached — without this the cell stays session:null
    // and is unrestorable on reload.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    const el2 = document.createElement("div");
    conn.attach("cell-race", target(null), second, el2);
    expect(second.onSession).toHaveBeenCalledWith("sess-123");
    expect(second.onCwd).toHaveBeenCalledWith("/resolved");
  });

  it("wires Shift+Enter through ensure(): registers a handler that sends \\x1b\\r on the ws and cancels the default", () => {
    mockKeyState.handler = () => true; // reset (the mock persists across tests)
    conn.attach("cell-key", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open so send() passes the readyState guard

    const preventDefault = vi.fn();
    const shiftEnter = { type: "keydown", key: "Enter", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, preventDefault };
    expect(mockKeyState.handler(shiftEnter)).toBe(false); // false => xterm won't also emit \r
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: conn.NEWLINE_SEQUENCE }));
    expect(preventDefault).toHaveBeenCalled(); // cancels the default so no follow-up keypress leaks a \r

    // A plain Enter is left to xterm (returns true, sends nothing extra).
    ws.sent.length = 0;
    expect(
      mockKeyState.handler({ type: "keydown", key: "Enter", shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn() }),
    ).toBe(true);
    expect(ws.sent).toHaveLength(0);
    conn.release("cell-key");
  });

  it("configures xterm with macOptionIsMeta so macOS Option acts as Meta (Alt bindings reach the PTY)", () => {
    mockTermState.options = {};
    conn.attach("cell-opt", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(mockTermState.options.macOptionIsMeta).toBe(true);
    conn.release("cell-opt");
  });

  // Selecting text must not hand the drag to the agent as mouse reports (#729). `allowProposedApi`
  // is load-bearing rather than cosmetic: `term.parser` throws without it, so a terminal would fail
  // to construct at all. macOptionClickForcesSelection is the macOS escape hatch — there, xterm
  // bypasses mouse mode for Option+drag ONLY when it is set (elsewhere Shift needs no option).
  it("registers the mouse-tracking guard on DECSET and DECRST, with the options it needs", () => {
    mockTermState.options = {};
    mockTermState.csiHandlers = [];
    conn.attach("cell-mouse", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    expect(mockTermState.options.allowProposedApi).toBe(true);
    expect(mockTermState.options.macOptionClickForcesSelection).toBe(true);
    // SET swallows; RESET is only observed (must keep returning false) so the wheel-report
    // record can follow the app's own mode teardown (#737) — see mouseTrackingGuard.spec.ts.
    expect(mockTermState.csiHandlers.map(([id]) => id)).toEqual([
      { prefix: "?", final: "h" },
      { prefix: "?", final: "l" },
    ]);
    conn.release("cell-mouse");
  });

  it("does not replay a session id before the server has assigned one", () => {
    const first = { onSession: vi.fn(), onCwd: vi.fn() };
    const el1 = document.createElement("div");
    conn.attach("cell-race", target(null), first, el1);
    FakeWebSocket.instances.at(-1)?.onopen?.();
    conn.detach("cell-race", el1);

    // No `session` message yet — reattaching must not synthesize a bogus id.
    const second = { onSession: vi.fn(), onCwd: vi.fn() };
    conn.attach("cell-race", target(null), second, document.createElement("div"));
    expect(second.onSession).not.toHaveBeenCalled();
    expect(second.onCwd).not.toHaveBeenCalled();
  });
});

// Claude Code emits OSC 52 with an EMPTY selection; the clipboard addon's default
// provider only writes for "c", so the empty case must also route to the clipboard.
describe("isSystemClipboard", () => {
  it("routes the empty selection (Claude Code's OSC 52) and explicit 'c' to the clipboard", () => {
    expect(conn.isSystemClipboard("")).toBe(true);
    expect(conn.isSystemClipboard("c")).toBe(true);
  });

  it("ignores primary / select / cut-buffer selections", () => {
    for (const sel of ["p", "s", "0", "7"]) expect(conn.isSystemClipboard(sel)).toBe(false);
  });
});

describe("shiftEnterNewline", () => {
  const ev = (over: Partial<KeyboardEvent>): Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "preventDefault"> => ({
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {},
    ...over,
  });

  it("returns the newline sequence for a Shift+Enter keydown", () => {
    expect(conn.shiftEnterNewline(ev({ shiftKey: true }))).toBe(conn.NEWLINE_SEQUENCE);
  });

  it("returns null for a plain Enter (so it still submits)", () => {
    expect(conn.shiftEnterNewline(ev({}))).toBeNull();
  });

  it("returns null on keyup and for non-Enter keys", () => {
    expect(conn.shiftEnterNewline(ev({ shiftKey: true, type: "keyup" }))).toBeNull();
    expect(conn.shiftEnterNewline(ev({ shiftKey: true, key: "a" }))).toBeNull();
  });

  it("returns null when another modifier is also held (Ctrl/Alt/Meta+Shift+Enter)", () => {
    for (const mod of ["altKey", "ctrlKey", "metaKey"] as const) {
      expect(conn.shiftEnterNewline(ev({ shiftKey: true, [mod]: true }))).toBeNull();
    }
  });

  it("makeShiftEnterHandler sends the newline, cancels the default, and preventDefaults on Shift+Enter", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = conn.makeShiftEnterHandler(send);
    expect(handler(ev({ shiftKey: true, preventDefault }))).toBe(false); // false => xterm won't also send \r
    expect(send).toHaveBeenCalledWith(conn.NEWLINE_SEQUENCE);
    expect(preventDefault).toHaveBeenCalled(); // else the browser fires a keypress and xterm submits a bare \r
  });

  it("makeShiftEnterHandler passes plain Enter through (returns true, sends nothing)", () => {
    const send = vi.fn();
    const handler = conn.makeShiftEnterHandler(send);
    expect(handler(ev({}))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });
});
