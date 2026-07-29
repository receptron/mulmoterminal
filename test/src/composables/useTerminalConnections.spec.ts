import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Capture the key handler ensure() registers, so a test can drive it and assert the
// real wiring (send + suppress-default) — hoisted so the mock factory can write to it.
// Defaults to a no-op that returns true, so a test that forgot to attach would see the
// pass-through behavior (and thus fail the Shift+Enter assertion) rather than crash.
const mockKeyState: { handler: (e: unknown) => boolean } = vi.hoisted(() => ({ handler: () => true }));
// The options ensure() passes to `new Terminal({...})`, captured for assertions.
type FakeWheelEvent = { deltaY: number; preventDefault: () => void };
const mockTermState: {
  options: Record<string, unknown>;
  csiHandlers: unknown[][];
  wheelHandler: (ev: FakeWheelEvent) => boolean;
  input: string[];
  bufferType: "normal" | "alternate";
  hasSelection: boolean;
  selection: string;
  onSelectionChange: () => void;
  helperTextarea: HTMLTextAreaElement | null;
} = vi.hoisted(() => ({
  options: {},
  csiHandlers: [],
  wheelHandler: () => true,
  input: [],
  bufferType: "normal",
  hasSelection: false,
  selection: "",
  onSelectionChange: () => {},
  helperTextarea: null,
}));

// Mock xterm + addons so the manager runs headless (no real DOM terminal / canvas).
// Factories are hoisted above imports, so the fakes are declared INSIDE them.
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    constructor(opts: Record<string, unknown>) {
      // The SAME object, not a copy: setFont/setTheme mutate `term.options` after construction,
      // and a test that only saw the constructor argument could not tell whether they landed.
      this.options = opts;
      mockTermState.options = opts;
    }
    // ensure() registers the mouse-tracking guards through this (#729); the guards' own behaviour
    // is covered against a REAL terminal in mouseTrackingGuard.spec.ts.
    parser = { registerCsiHandler: (...args: unknown[]) => mockTermState.csiHandlers.push(args) };
    loadAddon() {}
    registerLinkProvider() {}
    // Real xterm puts a hidden helper textarea inside the host, and the clipboard fallback finds
    // the copy target through it — a double that skipped it would let that path "pass" untested.
    open(host: HTMLElement) {
      const textarea = document.createElement("textarea");
      textarea.className = "xterm-helper-textarea";
      host.appendChild(textarea);
      mockTermState.helperTextarea = textarea;
    }
    onData() {}
    attachCustomKeyEventHandler(fn: (e: unknown) => boolean) {
      mockKeyState.handler = fn;
    }
    // The wheel guard (#737) is driven directly by the stale-mode test below.
    attachCustomWheelEventHandler(fn: (ev: FakeWheelEvent) => boolean) {
      mockTermState.wheelHandler = fn;
    }
    get buffer() {
      return { active: { type: mockTermState.bufferType } };
    }
    // The clipboard decision asks the terminal whether anything is selected (#900), so the
    // double has to answer. Selection-specific behaviour is covered in terminalClipboard.spec.
    hasSelection() {
      return mockTermState.hasSelection;
    }
    // Copy-on-select rides this pair (#900): xterm reports that the selection moved, and the
    // manager reads what it now is.
    onSelectionChange(fn: () => void) {
      mockTermState.onSelectionChange = fn;
    }
    getSelection() {
      return mockTermState.selection;
    }
    input(data: string) {
      mockTermState.input.push(data);
    }
    write() {}
    refresh() {}
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
import { newlineSequence, submitSequence } from "../../../common/terminalSubmit";
import { setTerminalSubmitMode } from "../../../src/composables/terminalSubmitMode";
import { setCopyOnSelect } from "../../../src/composables/copyOnSelect";

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

  it("wires the Enter handler through ensure() (cr mode): sends \\x1b\\r on Shift+Enter and cancels the default", () => {
    mockKeyState.handler = () => true; // reset (the mock persists across tests)
    setTerminalSubmitMode("cr");
    conn.attach("cell-key", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open so send() passes the readyState guard

    const preventDefault = vi.fn();
    const shiftEnter = { type: "keydown", key: "Enter", shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, preventDefault };
    expect(mockKeyState.handler(shiftEnter)).toBe(false); // false => xterm won't also emit \r
    expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("cr") }));
    expect(preventDefault).toHaveBeenCalled(); // cancels the default so no follow-up keypress leaks a \r

    // A plain Enter is left to xterm (returns true, sends nothing extra).
    ws.sent.length = 0;
    expect(
      mockKeyState.handler({
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      }),
    ).toBe(true);
    expect(ws.sent).toHaveLength(0);
    conn.release("cell-key");
  });

  it("wires the Enter handler through ensure() (esc-cr mode): submits a bare Enter with \\x1b\\r and makes Shift+Enter a \\r newline", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("esc-cr");
    try {
      conn.attach("cell-esc", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("no socket created");
      ws.onopen?.();

      // Bare Enter → submit (ESC+CR), default cancelled.
      const enter = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(enter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));

      // Shift+Enter → newline (CR).
      ws.sent.length = 0;
      const shiftEnter = {
        type: "keydown",
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(shiftEnter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("esc-cr") }));

      // An IME candidate-confirm Enter must NOT be eaten as a submit — the guard that
      // protects Japanese input in the one mode where a bare Enter is intercepted.
      ws.sent.length = 0;
      const composing = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: true,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(composing)).toBe(true);
      expect(ws.sent).toHaveLength(0);

      conn.release("cell-esc");
    } finally {
      setTerminalSubmitMode("cr"); // module global — reset so later tests see the default
    }
  });

  it("does NOT apply esc-cr to a shell cell — a bare Enter stays native \\r (scoped to Claude sessions)", () => {
    mockKeyState.handler = () => true;
    setTerminalSubmitMode("esc-cr");
    try {
      const shellTarget = { ...target(null), launcher: { shell: true as const } };
      conn.attach("cell-shell", shellTarget, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
      const ws = FakeWebSocket.instances.at(-1);
      if (!ws) throw new Error("no socket created");
      ws.onopen?.();
      ws.sent.length = 0; // drop the socket's init sends so we only see what the key emits

      // A shell's bare Enter must NOT be rewritten to ESC+CR — it stays xterm's native \r.
      const enter = {
        type: "keydown",
        key: "Enter",
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(enter)).toBe(true); // passes through to xterm
      expect(ws.sent).toHaveLength(0);

      // Shift+Enter keeps the standard newline (ESC+CR), same as before the setting existed.
      const shiftEnter = {
        type: "keydown",
        key: "Enter",
        shiftKey: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        preventDefault: vi.fn(),
      };
      expect(mockKeyState.handler(shiftEnter)).toBe(false);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: newlineSequence("cr") }));

      conn.release("cell-shell");
    } finally {
      setTerminalSubmitMode("cr");
    }
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

  // The swallowed modes describe ONE session. An app that dies without sending DECRST would
  // otherwise leave the slot believing the next app wants mouse reports, and that app's wheel
  // would deliver escape bytes instead of scrolling — the #729 noise, one layer over (#737).
  it("forgets swallowed mouse modes when the session is replaced, so the wheel guard doesn't leak across a reconnect", () => {
    vi.useFakeTimers();
    mockTermState.csiHandlers = [];
    mockTermState.input = [];
    mockTermState.bufferType = "alternate";
    mockTermState.wheelHandler = () => true;
    conn.attach("cell-race", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));

    const decset = mockTermState.csiHandlers.find(([id]) => (id as { final: string }).final === "h")?.[1] as (p: (number | number[])[]) => boolean;
    decset([1002, 1006]); // the app asks for drag tracking + SGR: swallowed, and remembered
    const wheel = mockTermState.wheelHandler;
    expect(wheel({ deltaY: 1, preventDefault: () => {} })).toBe(false);
    expect(mockTermState.input).toEqual(["\x1b[<65;1;1M"]);

    // The app dies WITHOUT the matching DECRST and the socket drops; the slot reconnects.
    FakeWebSocket.instances.at(-1)?.onclose?.();
    vi.advanceTimersByTime(10_000);
    mockTermState.input = [];

    // A later alt-buffer app that never asked for tracking keeps xterm's own scrolling.
    expect(wheel({ deltaY: 1, preventDefault: () => {} })).toBe(true);
    expect(mockTermState.input).toEqual([]);
    vi.useRealTimers();
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

// Copy-on-select (#900). The decision itself is unit-tested in terminalClipboard.spec; what is
// asserted here is the WIRING — that the drag's flood of events becomes at most one clipboard
// write, and that the setting is what gates it.
describe("copy-on-select wiring", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const execCommand = vi.fn<(commandId: string) => boolean>(() => true);
  let cellEl: HTMLDivElement;
  // Torn down in afterEach rather than inline, so a failing assertion cannot leave a focused node
  // in the document — the fallback tests read document.activeElement, so one failure would
  // cascade into the others.
  let elsewhere: HTMLInputElement | null = null;

  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    mockTermState.onSelectionChange = () => {};
    mockTermState.selection = "";
    mockTermState.hasSelection = false;
    mockTermState.helperTextarea = null;
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    execCommand.mockClear();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    // jsdom implements no execCommand at all, and the fallback needs a real one to observe.
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true, writable: true });
    // In the document, not detached: the fallback's focus check is answered by
    // document.activeElement, which only follows focus() for an element that is actually attached.
    cellEl = document.createElement("div");
    document.body.appendChild(cellEl);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // unstubAllGlobals does NOT undo defineProperty on `document`, and jsdom ships no native
    // execCommand — leaving the stub would hand every later suite one that silently returns true.
    Reflect.deleteProperty(document, "execCommand");
    setCopyOnSelect(false);
    conn.release("cell-select");
    cellEl.remove();
    elsewhere?.remove();
    elsewhere = null;
  });

  const attachTerminal = (): void => {
    conn.attach("cell-select", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, cellEl);
  };

  // The selection as the terminal would report it — both halves, since the wiring reads each for a
  // different job (hasSelection per event, getSelection once it settles).
  const select = (text: string): void => {
    mockTermState.selection = text;
    mockTermState.hasSelection = text !== "";
    mockTermState.onSelectionChange();
  };

  // xterm fires on every coordinate change, so a drag is a burst. Writing each one would fill the
  // OS clipboard history (Win+V) with partial selections — only the settled text may land.
  it("writes once for a whole drag, with the text the selection settled on", async () => {
    setCopyOnSelect(true);
    attachTerminal();

    for (const partial of ["npm", "npm run", "npm run build"]) {
      select(partial);
      await vi.advanceTimersByTimeAsync(20); // still mid-drag: under the settle window
    }
    expect(writeText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("npm run build");
  });

  // The default. Highlighting must not touch the clipboard for anyone who did not ask for this.
  it("writes nothing while the setting is off", async () => {
    attachTerminal();
    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  // A selection can settle again unchanged (a drag that runs past the end of a line moves the
  // coordinates without moving the text). A second write buys nothing and costs a duplicate entry
  // in the OS clipboard history.
  it("does not write the same selection twice while it stands", async () => {
    setCopyOnSelect(true);
    attachTerminal();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  // But once the selection is gone, selecting the same text is a fresh intent — the user may have
  // copied something else in between, and "you already copied that" would leave them holding the
  // wrong thing with nothing to show for it.
  it("copies the same text again after the selection was cleared", async () => {
    setCopyOnSelect(true);
    attachTerminal();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    select(""); // a click elsewhere in the terminal
    select("npm run build"); // re-dragged inside the same settle window as the clear
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  // The whole answer to reaching this app at http://<lan-ip>: browsers restrict the Clipboard API
  // to secure contexts, so `navigator.clipboard` is not merely blocked there, it is ABSENT. Asking
  // xterm to copy through its own listener is what still works.
  it("falls back to xterm's own copy when the browser exposes no clipboard API", async () => {
    setCopyOnSelect(true);
    vi.stubGlobal("navigator", {}); // an insecure context
    attachTerminal();
    mockTermState.helperTextarea?.focus();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  // Same route when the API exists but refuses (no document focus, permission denied): one failure
  // must not end the attempt.
  it("falls back after a rejected clipboard write", async () => {
    setCopyOnSelect(true);
    writeText.mockRejectedValue(new Error("not focused"));
    attachTerminal();
    mockTermState.helperTextarea?.focus();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(writeText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  // The fallback needs the terminal's textarea focused, and deliberately does NOT take focus to get
  // it: if the user has moved on in the settle window, pulling focus back mid-typing would be a
  // worse outcome than a selection that did not copy.
  it("gives up rather than stealing focus back from wherever it went", async () => {
    setCopyOnSelect(true);
    vi.stubGlobal("navigator", {});
    attachTerminal();
    elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    select("npm run build");
    await vi.advanceTimersByTimeAsync(500);
    expect(execCommand).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
  });

  // A clipboard write can stay pending far longer than the settle window — a browser that asks for
  // clipboard permission holds it open until the user answers. Fired as they came due, two writes
  // would then resolve in whatever order the browser picked, and the clipboard could end up with
  // the older selection. Each write therefore waits for the one before it.
  it("holds a newer write until the pending one finishes, so the older text cannot win", async () => {
    setCopyOnSelect(true);
    attachTerminal();
    const finish: Array<() => void> = [];
    writeText.mockImplementation(() => new Promise<void>((resolve) => finish.push(resolve)));

    select("first");
    await vi.advanceTimersByTimeAsync(200);
    expect(writeText).toHaveBeenCalledTimes(1); // in flight, and staying there

    select("second");
    await vi.advanceTimersByTimeAsync(200);
    expect(writeText).toHaveBeenCalledTimes(1); // settled, but must not start yet

    finish[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenNthCalledWith(2, "second");
  });
});

describe("isOpenableTerminalLink", () => {
  it("opens http and https OSC 8 targets", () => {
    expect(conn.isOpenableTerminalLink("https://github.com/o/r/pull/2541")).toBe(true);
    expect(conn.isOpenableTerminalLink("http://localhost:3000/x")).toBe(true);
    expect(conn.isOpenableTerminalLink("HTTPS://EXAMPLE.COM")).toBe(true); // scheme is case-insensitive
  });

  // A terminal program is untrusted output — a `javascript:`/`file:`/relative target must NOT open.
  it.each(["javascript:alert(1)", "file:///etc/passwd", "mailto:a@b.com", "vscode://x", "/rel/path", "example.com", ""])(
    "refuses non-http(s) target %j",
    (uri) => {
      expect(conn.isOpenableTerminalLink(uri)).toBe(false);
    },
  );
});

describe("OSC 8 link handler wiring", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    mockTermState.options = {};
  });

  it("ensure() sets a linkHandler that opens http(s) links and ignores others", () => {
    conn.attach("cell-link", target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const handler = mockTermState.options.linkHandler as { activate: (e: unknown, uri: string) => void } | undefined;
    expect(handler).toBeTruthy();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      handler?.activate({}, "https://github.com/o/r/pull/2541");
      expect(open).toHaveBeenCalledWith("https://github.com/o/r/pull/2541", "_blank", "noopener,noreferrer");
      open.mockClear();
      handler?.activate({}, "javascript:alert(1)"); // must not open
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      conn.release("cell-link");
    }
  });
});

// The pure key→bytes decision (enterKeyOverride) is covered in test/common/terminalSubmit.spec.ts;
// here we cover the thin wrapper that turns that decision into a send + preventDefault, and that
// it re-reads the mode getter each call so a live config change takes effect.
describe("makeEnterHandler", () => {
  const ev = (
    over: Partial<KeyboardEvent>,
  ): Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "preventDefault"> => ({
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    preventDefault: () => {},
    ...over,
  });

  it("cr mode: sends the newline sequence on Shift+Enter, cancels the default, and preventDefaults", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = conn.makeEnterHandler(() => "cr", send);
    expect(handler(ev({ shiftKey: true, preventDefault }))).toBe(false); // false => xterm won't also send \r
    expect(send).toHaveBeenCalledWith(newlineSequence("cr"));
    expect(preventDefault).toHaveBeenCalled(); // else the browser fires a keypress and xterm submits a bare \r
  });

  it("cr mode: passes a plain Enter through (returns true, sends nothing)", () => {
    const send = vi.fn();
    const handler = conn.makeEnterHandler(() => "cr", send);
    expect(handler(ev({}))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("esc-cr mode: submits a bare Enter with the ESC+CR sequence and cancels the default", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = conn.makeEnterHandler(() => "esc-cr", send);
    expect(handler(ev({ preventDefault }))).toBe(false);
    expect(send).toHaveBeenCalledWith(submitSequence("esc-cr"));
    expect(preventDefault).toHaveBeenCalled();
  });

  it("reads the mode getter on every keydown, so a live config change is honoured", () => {
    const send = vi.fn();
    let mode: "cr" | "esc-cr" = "cr";
    const handler = conn.makeEnterHandler(() => mode, send);
    expect(handler(ev({}))).toBe(true); // cr: a bare Enter is left to xterm
    mode = "esc-cr";
    expect(handler(ev({}))).toBe(false); // esc-cr: the same key is now intercepted as submit
    expect(send).toHaveBeenCalledWith(submitSequence("esc-cr"));
  });
});

// The GUI-originated sends (header run:"input", skill invocation, worktree commit prompt)
// paste/type text then submit a beat later — that delayed submit byte must follow the same
// Claude-scoped mapping as the keyboard, or a Claude cell in esc-cr mode never submits.
describe("submitText / pasteAndSubmit — delayed submit follows terminalSubmit (Claude-scoped)", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    setTerminalSubmitMode("cr");
  });
  afterEach(() => setTerminalSubmitMode("cr"));

  const openCell = (key: string, t: conn.ConnTarget) => {
    conn.attach(key, t, { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.();
    ws.sent.length = 0; // drop init sends
    return ws;
  };

  it("submitText: a Claude cell in esc-cr submits with ESC+CR (text first, submit delayed)", () => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode("esc-cr");
      const ws = openCell("cell-st", target(null));
      expect(conn.submitText("cell-st", "/compact")).toBe(true);
      expect(ws.sent).toEqual([JSON.stringify({ type: "input", data: "/compact" })]); // submit not yet
      vi.advanceTimersByTime(60);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));
      conn.release("cell-st");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submitText: a shell cell submits with plain \\r even in esc-cr", () => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode("esc-cr");
      const ws = openCell("cell-st2", { ...target(null), launcher: { shell: true as const } });
      conn.submitText("cell-st2", "ls");
      vi.advanceTimersByTime(60);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: "\r" }));
      expect(ws.sent).not.toContain(JSON.stringify({ type: "input", data: "\x1b\r" }));
      conn.release("cell-st2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pasteAndSubmit: a Claude cell in esc-cr submits with ESC+CR after the paste", () => {
    vi.useFakeTimers();
    try {
      setTerminalSubmitMode("esc-cr");
      const ws = openCell("cell-ps", target(null));
      expect(conn.pasteAndSubmit("cell-ps", "line1\nline2")).toBe(true);
      vi.advanceTimersByTime(200);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: submitSequence("esc-cr") }));
      conn.release("cell-ps");
    } finally {
      vi.useRealTimers();
    }
  });

  it("submitText: the default cr mode still submits with plain \\r", () => {
    vi.useFakeTimers();
    try {
      const ws = openCell("cell-st3", target(null));
      conn.submitText("cell-st3", "hi");
      vi.advanceTimersByTime(60);
      expect(ws.sent).toContain(JSON.stringify({ type: "input", data: "\r" }));
      conn.release("cell-st3");
    } finally {
      vi.useRealTimers();
    }
  });
});

// terminalSubmit is Claude's binding, so it must apply only to Claude cells — a shell /
// codex / command / dev-terminal cell keeps the standard binding regardless of the setting.
describe("isClaudeTarget", () => {
  const base = { sessionId: null, cwd: "/x", devTerminal: false, command: null, launcher: null };

  it("is true for a plain Claude cell", () => {
    expect(conn.isClaudeTarget({ ...base })).toBe(true);
    // A launch (provider/model) choice is Claude-only, so it's still a Claude cell.
    expect(conn.isClaudeTarget({ ...base, launch: { provider: "openrouter", model: "x" } })).toBe(true);
  });

  it("is false for shell / codex / command / dev-terminal cells", () => {
    expect(conn.isClaudeTarget({ ...base, launcher: { shell: true } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, launcher: { index: 0 } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, agent: "codex" })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, agent: "antigravity" })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, command: { source: "script", index: 0, label: "dev", cwd: null } })).toBe(false);
    expect(conn.isClaudeTarget({ ...base, devTerminal: true })).toBe(false);
  });
});

// The load-bearing half of #860/#864, and the half nothing asserted until now: changing the font
// changes the CELL METRICS, so cols/rows change and the PTY has to be told. Delete the re-fit from
// setFont and every other test in this repo still passes, while the bug #860 was filed for — a
// canvas grid the shell disagrees with, so the cursor and wrap points drift — comes silently back.
//
// The observable contract is the resize frame on the wire, not a call count, so that is what these
// assert.
describe("setFont — a font change must reach the PTY, not just the canvas", () => {
  const FONT = { size: 14, family: "'JetBrains Mono', monospace" };
  const resizes = (ws: FakeWebSocket) => ws.sent.filter((m) => JSON.parse(m).type === "resize");

  function attachOpenSlot(key: string) {
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    conn.attach(key, target(null), { onSession: vi.fn(), onCwd: vi.fn() }, document.createElement("div"), undefined, FONT);
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("no socket created");
    ws.onopen?.(); // open, so fitAndSyncSize's readyState guard lets the resize through
    ws.sent.length = 0; // ignore the frames attach() itself produced
    return ws;
  }

  afterEach(() => {
    conn.release("cell-font");
  });

  it("applies BOTH options and pushes the new geometry to the PTY", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { size: 24, family: "'Songti SC', monospace" });

    expect(mockTermState.options.fontSize).toBe(24);
    expect(mockTermState.options.fontFamily).toBe("'Songti SC', monospace");
    expect(resizes(ws)).toHaveLength(1);
  });

  // A family alone moves the advance width just as a size does, so it must re-fit too — the case
  // #864 added and the one a size-only implementation would quietly miss.
  it("re-fits for a family change on its own, not only a size change", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { size: FONT.size, family: "'Songti SC', monospace" });

    expect(mockTermState.options.fontFamily).toBe("'Songti SC', monospace");
    expect(resizes(ws)).toHaveLength(1);
  });

  // Terminal.vue's watcher fires on every dir-config resolution, and most directories pin no font
  // at all. Re-fitting there would churn every terminal on every load for nothing.
  it("does nothing when the font is unchanged", () => {
    const ws = attachOpenSlot("cell-font");

    conn.setFont("cell-font", { ...FONT });

    expect(resizes(ws)).toHaveLength(0);
  });

  it("ignores a slot that does not exist rather than throwing", () => {
    expect(() => conn.setFont("cell-not-here", { size: 20, family: "monospace" })).not.toThrow();
  });
});

// #1005. The pure key->bytes decision (sendBytesFor) is covered in test/common/keymapSend.spec.ts;
// here we cover the wrapper — that it sends, cancels xterm's own handling, and preventDefaults,
// and that it re-reads the keymap each call so editing config.json takes effect without a reload.
describe("makeSendHandler", () => {
  const CTRL_E = "\u0005";
  const key = (
    over: Partial<KeyboardEvent>,
  ): Pick<KeyboardEvent, "type" | "key" | "shiftKey" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "preventDefault"> => ({
    type: "keydown",
    key: "ArrowRight",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: true,
    isComposing: false,
    preventDefault: () => {},
    ...over,
  });
  const bound = { send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] };

  it("sends the bytes, cancels xterm's handling, and preventDefaults", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = conn.makeSendHandler(() => bound, send);
    expect(handler(key({ preventDefault }))).toBe(false); // false => xterm does not also translate the key
    expect(send).toHaveBeenCalledWith(CTRL_E);
    // Without this the browser fires a follow-up keypress that arrives as stray input — the same
    // trap makeEnterHandler documents.
    expect(preventDefault).toHaveBeenCalled();
  });

  it("passes an unbound key through untouched", () => {
    const send = vi.fn();
    const preventDefault = vi.fn();
    const handler = conn.makeSendHandler(() => bound, send);
    expect(handler(key({ key: "ArrowLeft", preventDefault }))).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("takes no key at all when nothing is bound", () => {
    const send = vi.fn();
    const handler = conn.makeSendHandler(() => ({}), send);
    expect(handler(key({}))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  // Read through a getter, not captured: the keymap is hydrated asynchronously from /api/config
  // and can change while a terminal is open.
  it("re-reads the keymap on every keystroke", () => {
    const send = vi.fn();
    let keymap: { send?: { key: string; bytes: string }[] } = {};
    const handler = conn.makeSendHandler(() => keymap, send);
    expect(handler(key({}))).toBe(true);
    keymap = bound;
    expect(handler(key({}))).toBe(false);
    expect(send).toHaveBeenCalledWith(CTRL_E);
  });
});
