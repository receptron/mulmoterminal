// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { WebSocket } from "ws";
import type { IPty } from "node-pty";

import { beginRunTerminal, type WsRouteDeps } from "../../../server/routes/ws-routes.js";
import { bufferEarlyFrames } from "../../../server/session/pty/early-frames.js";
import { killPty } from "../../../server/session/pty/pty-kill.js";

vi.mock("../../../server/session/pty/pty-kill.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/session/pty/pty-kill.js")>()),
  killPty: vi.fn(),
}));

// A minimal ws stand-in: just the readyState + OPEN the guard reads and an on/off/emit trio so a
// test can fire the "close" event the handler wires, and feed it frames.
function fakeWs(readyState: number) {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    readyState,
    OPEN: 1,
    on(event: string, cb: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
    },
    off(event: string, cb: (...args: unknown[]) => void) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((l) => l !== cb),
      );
    },
    emit(event: string, ...args: unknown[]) {
      [...(listeners.get(event) ?? [])].forEach((cb) => cb(...args));
    },
  };
}

const OPEN = 1;
const CLOSED = 3;
const RESOLVED = { command: "npm run dev", cwd: "/repo" };

describe("beginRunTerminal", () => {
  it("spawns and kills the ephemeral PTY when the viewer's socket is still open", () => {
    const term = { kill: vi.fn() } as unknown as IPty;
    const spawnCommandPty = vi.fn(() => term);
    const ws = fakeWs(OPEN);

    beginRunTerminal({ spawnCommandPty } as unknown as WsRouteDeps, ws as unknown as WebSocket, RESOLVED);

    expect(spawnCommandPty).toHaveBeenCalledWith(RESOLVED.command, RESOLVED.cwd, ws);
    ws.emit("close"); // the viewer leaves — the ephemeral PTY must be killed, and what it started
    // under its shell with it: the group scope is what reaches a command's own children (#2401).
    expect(killPty).toHaveBeenCalledWith(term, { label: "command cell", scope: "group" });
  });

  // The leak: the viewer left during the (git-backed) resolve, so the socket is already
  // closed by the time we get here. Spawning now would leak a PTY whose only kill is a close
  // handler for an event that already fired.
  it("does not spawn a PTY when the socket closed during the async resolve", () => {
    const spawnCommandPty = vi.fn();
    const ws = fakeWs(CLOSED);

    beginRunTerminal({ spawnCommandPty } as unknown as WsRouteDeps, ws as unknown as WebSocket, RESOLVED);

    expect(spawnCommandPty).not.toHaveBeenCalled();
  });

  // The browser's first frame is the terminal's geometry, sent the instant the socket opens —
  // during that same git-backed resolve. It is collected from the accept and replayed into the pty
  // once there is one, the same way the agent endpoints do it (#2986).
  it("replays a resize that arrived while the command was still being resolved", () => {
    const term = { kill: vi.fn(), resize: vi.fn(), write: vi.fn() } as unknown as IPty;
    const ws = fakeWs(OPEN);
    const early = bufferEarlyFrames(ws as unknown as WebSocket);
    ws.emit("message", JSON.stringify({ type: "resize", cols: 140, rows: 45 }));

    beginRunTerminal({ spawnCommandPty: vi.fn(() => term) } as unknown as WsRouteDeps, ws as unknown as WebSocket, RESOLVED, { early });

    expect(term.resize).toHaveBeenCalledWith(140, 45);
  });
});
