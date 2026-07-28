import { describe, it, expect } from "vitest";
import { bufferEarlyFrames } from "../../../server/session/early-frames.js";

// The browser sends the terminal's real geometry the instant the socket opens. A grid codex
// connection reads its directory's registered tool groups off disk before it can spawn, and
// anything arriving in that window used to reach a listener that did not exist yet — a lost
// resize leaves the pty at 80x24 while the browser draws the real size.
class FakeSocket {
  private listeners: ((raw: unknown) => void)[] = [];
  on(event: string, cb: (raw: unknown) => void) {
    if (event === "message") this.listeners.push(cb);
    return this;
  }
  off(event: string, cb: (raw: unknown) => void) {
    if (event === "message") this.listeners = this.listeners.filter((l) => l !== cb);
    return this;
  }
  emit(raw: unknown) {
    for (const l of [...this.listeners]) l(raw);
  }
  get listenerCount() {
    return this.listeners.length;
  }
}

const socket = () => new FakeSocket() as unknown as FakeSocket & Parameters<typeof bufferEarlyFrames>[0];

describe("bufferEarlyFrames", () => {
  it("replays what arrived before the session existed, in order", () => {
    const ws = socket();
    const early = bufferEarlyFrames<string>(ws);
    ws.emit("resize-80x24");
    ws.emit("input-a");

    const delivered: string[] = [];
    early.release((raw) => delivered.push(raw));
    expect(delivered).toEqual(["resize-80x24", "input-a"]);
  });

  // Releasing must also STOP collecting, or every later frame would pile up in a buffer nobody
  // drains again — the terminal would go dead after its first keystroke.
  it("stops collecting once released", () => {
    const ws = socket();
    const early = bufferEarlyFrames<string>(ws);
    early.release(() => {});
    expect(ws.listenerCount).toBe(0);
  });

  it("delivers nothing when nothing arrived", () => {
    const ws = socket();
    const early = bufferEarlyFrames<string>(ws);
    const delivered: string[] = [];
    early.release((raw) => delivered.push(raw));
    expect(delivered).toEqual([]);
  });

  // A connection whose spawn failed has no pty to replay into.
  it("drops what it holds when discarded", () => {
    const ws = socket();
    const early = bufferEarlyFrames<string>(ws);
    ws.emit("input-a");
    early.discard();
    expect(ws.listenerCount).toBe(0);

    const delivered: string[] = [];
    early.release((raw) => delivered.push(raw));
    expect(delivered).toEqual([]);
  });
});
