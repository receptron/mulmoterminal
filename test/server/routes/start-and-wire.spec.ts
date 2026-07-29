import { describe, it, expect, vi } from "vitest";
import type { WebSocket } from "ws";
import { startAndWire } from "../../../server/routes/ws-routes.js";
import { bufferEarlyFrames } from "../../../server/session/early-frames.js";
import type { PtyEntry } from "../../../server/session/types.js";

// #1074 pulled this out of the launch and codex paths, which had written the same steps twice —
// and the ORDER is what the function is for. The buffered early frames may only be replayed once
// the real message listener is installed, or a frame that lands mid-replay overtakes the ones
// before it. That rule used to be a comment on the codex path and absent from the launch path;
// here it is a test.

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, ((raw: unknown) => void)[]>();

  on(event: string, cb: (raw: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return this;
  }
  off(event: string, cb: (raw: unknown) => void) {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((l) => l !== cb),
    );
    return this;
  }
  emit(event: string, raw?: unknown) {
    for (const l of [...(this.listeners.get(event) ?? [])]) l(raw);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.closed = true;
  }
}

const asWebSocket = (socket: FakeSocket): WebSocket => socket as unknown as WebSocket;
const entry = { pty: null } as unknown as PtyEntry;

function harness() {
  const socket = new FakeSocket();
  const delivered: string[] = [];
  const handleClientClose = vi.fn();
  const deps = {
    handleClientFrame: (_entry: PtyEntry, _ws: WebSocket, raw: { toString(): string }): void => {
      delivered.push(raw.toString());
    },
    handleClientClose,
  };
  const early = bufferEarlyFrames<{ toString(): string }>(asWebSocket(socket));
  return { socket, delivered, handleClientClose, deps, early };
}

describe("startAndWire", () => {
  it("replays what arrived before the pty existed, then live frames, in arrival order", () => {
    const { socket, delivered, deps, early } = harness();
    socket.emit("message", "resize-80x24"); // arrived while the spawn was still deciding
    socket.emit("message", "first-keystroke");

    startAndWire(deps, asWebSocket(socket), { id: "s1", tag: "codex", early, startFailureMessage: () => "nope" }, () => entry);
    socket.emit("message", "after-spawn");

    expect(delivered).toEqual(["resize-80x24", "first-keystroke", "after-spawn"]);
  });

  // The reason the release comes last: a frame landing DURING the replay must reach the real
  // listener, not a buffer nobody drains again — and it must not overtake what was already queued.
  it("keeps order for a frame that lands mid-replay", () => {
    const { socket, delivered, deps, early } = harness();
    let reentered = false;
    const reentrantDeps = {
      ...deps,
      handleClientFrame: (_entry: PtyEntry, _ws: WebSocket, raw: { toString(): string }): void => {
        delivered.push(raw.toString());
        if (reentered) return;
        reentered = true;
        socket.emit("message", "landed-mid-replay");
      },
    };
    socket.emit("message", "buffered-1");
    socket.emit("message", "buffered-2");

    startAndWire(reentrantDeps, asWebSocket(socket), { id: "s1", tag: "codex", early, startFailureMessage: () => "nope" }, () => entry);

    expect(delivered).toEqual(["buffered-1", "landed-mid-replay", "buffered-2"]);
  });

  it("wires the close handler to the started entry", () => {
    const { socket, handleClientClose, deps, early } = harness();
    startAndWire(deps, asWebSocket(socket), { id: "s1", tag: "launch", early, startFailureMessage: () => "nope" }, () => entry);
    socket.emit("close");
    expect(handleClientClose).toHaveBeenCalledWith(entry, expect.anything(), "s1");
  });

  // A spawn that throws is a missing CLI or a directory that vanished. There is no pty to replay
  // into, so the buffer is dropped rather than delivered, and the socket is told why.
  describe("when the spawn refuses", () => {
    const refuse = () => {
      const h = harness();
      h.socket.emit("message", "resize-80x24");
      startAndWire(h.deps, asWebSocket(h.socket), { id: "s1", tag: "codex", early: h.early, startFailureMessage: () => "no codex on PATH" }, () => {
        throw new Error("spawn failed");
      });
      return h;
    };

    it("closes the socket with the caller's message", () => {
      const { socket } = refuse();
      expect(JSON.parse(socket.sent[0])).toEqual({ type: "error", message: "no codex on PATH" });
      expect(socket.closed).toBe(true);
    });

    it("delivers nothing, then or later", () => {
      const { socket, delivered } = refuse();
      socket.emit("message", "after-failure");
      expect(delivered).toEqual([]);
    });

    // The message is built FROM the error, not fixed: a pre-spawn diagnosis (#1063) is already a
    // sentence for the user, and swallowing it would put `spawn ENOENT` in the terminal instead.
    it("hands the thrown error to the caller's message builder", () => {
      const { socket, early, deps } = harness();
      const thrown = new Error("codex is not on PATH");
      startAndWire(deps, asWebSocket(socket), { id: "s1", tag: "codex", early, startFailureMessage: (err) => `saw: ${(err as Error).message}` }, () => {
        throw thrown;
      });
      expect(JSON.parse(socket.sent[0]).message).toBe("saw: codex is not on PATH");
    });
  });
});
