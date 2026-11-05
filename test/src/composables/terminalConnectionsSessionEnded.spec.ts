// The slot's session-ended mark (#3276, #3280): set by an exit frame that ended the session or by a
// failed start, left alone by one that only lost the client, cleared by output from a running
// process — not by the `session` frame, which the server sends before it spawns — and kept while
// the view is detached, which is what a cell remounted on the slot reads.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { termState: mockTermState, keyState: mockKeyState } = await vi.hoisted(async () => (await import("../../helpers/xtermDouble")).createXtermState());

vi.mock("@xterm/xterm", async () => (await import("../../helpers/xtermDouble")).xtermModule(mockTermState, mockKeyState));
vi.mock("@xterm/addon-fit", async () => (await import("../../helpers/xtermDouble")).fitAddonModule());
vi.mock("@xterm/addon-web-links", async () => (await import("../../helpers/xtermDouble")).webLinksAddonModule());
vi.mock("@xterm/addon-clipboard", async () => (await import("../../helpers/xtermDouble")).clipboardAddonModule());
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import * as conn from "../../../src/composables/useTerminalConnections";
import { FakeWebSocket } from "../../helpers/xtermDouble";

const KEY = "cell-ended";
const SESSION = "11111111-2222-4333-8444-555555555555";
const target: conn.ConnTarget = { sessionId: SESSION, cwd: "/w", devTerminal: false, command: null, launcher: null };
const exitFrame = (ended: boolean) => ({ data: JSON.stringify({ type: "exit", exitCode: 137, ended, lifetimeMs: 60_000, reattached: false }) });
const sessionFrame = { data: JSON.stringify({ type: "session", id: SESSION, cwd: "/w" }) };
const errorFrame = { data: JSON.stringify({ type: "error", message: "failed to start" }) };
const outputFrame = { data: JSON.stringify({ type: "output", data: "hello" }) };
const ended = () => conn.connView.get(KEY)?.sessionEnded;

let host: HTMLElement;
const openCell = (): FakeWebSocket => {
  host = document.createElement("div");
  conn.attach(KEY, target, {}, host);
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no socket created");
  ws.onopen?.();
  return ws;
};

describe("a slot's session-ended mark", () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => {
    conn.release(KEY);
    vi.unstubAllGlobals();
  });

  it("starts unset", () => {
    openCell();
    expect(ended()).toBe(false);
  });

  it("is set by an exit that ended the session", () => {
    openCell().onmessage?.(exitFrame(true));
    expect(ended()).toBe(true);
  });

  it("is not set by an exit that only lost the client", () => {
    openCell().onmessage?.(exitFrame(false));
    expect(ended()).toBe(false);
  });

  // A restart's new socket: announced, then the spawn — which may fail.
  it("stays set through the session frame of a restart", () => {
    const ws = openCell();
    ws.onmessage?.(exitFrame(true));
    ws.onmessage?.(sessionFrame);
    expect(ended()).toBe(true);
  });

  it("is set by a start that failed after the session was announced", () => {
    const ws = openCell();
    ws.onmessage?.(sessionFrame);
    ws.onmessage?.(errorFrame);
    expect(ended()).toBe(true);
  });

  // A switched subscription prints its notice before the spawn, which can still throw.
  it("is set again when a notice printed before the spawn is followed by a failed start", () => {
    const ws = openCell();
    ws.onmessage?.(exitFrame(true));
    ws.onmessage?.(sessionFrame);
    ws.onmessage?.(outputFrame);
    ws.onmessage?.(errorFrame);
    expect(ended()).toBe(true);
  });

  it("is cleared by output once the agent runs", () => {
    const ws = openCell();
    ws.onmessage?.(exitFrame(true));
    ws.onmessage?.(sessionFrame);
    ws.onmessage?.(outputFrame);
    expect(ended()).toBe(false);
  });

  it("survives the view detaching and a new view attaching", () => {
    openCell().onmessage?.(exitFrame(true));
    conn.detach(KEY, host);
    conn.attach(KEY, target, {}, document.createElement("div"));
    expect(ended()).toBe(true);
  });
});
