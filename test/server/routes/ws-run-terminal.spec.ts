// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { WebSocket } from "ws";
import type { IPty } from "node-pty";

import { beginRunTerminal, type WsRouteDeps } from "../../../server/routes/ws-routes.js";

// A minimal ws stand-in: just the readyState + OPEN the guard reads and an on/emit pair so a
// test can fire the "close" event the handler wires.
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
    emit(event: string) {
      (listeners.get(event) ?? []).forEach((cb) => cb());
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
    ws.emit("close"); // the viewer leaves — the ephemeral PTY must be killed
    expect(term.kill).toHaveBeenCalledTimes(1);
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
});
