// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOutputRelay, wireBufferedOutput } from "../../../server/session/output-relay.js";
import type { PtyEntry } from "../../../server/session/types.js";

const OPEN = 1;
const LIMIT = 1000;
const FLUSH_INTERVAL_MS = 8;

function fakeSocket() {
  const sent: string[] = [];
  return { sent, socket: { readyState: OPEN, OPEN, send: (d: string) => sent.push(d), close: () => undefined } };
}

// Only the fields the relay touches; the rest of a PtyEntry has no bearing here.
function fakeEntry(socket: ReturnType<typeof fakeSocket>["socket"] | null) {
  return { ws: socket, buffer: "" } as unknown as PtyEntry;
}

const outputs = (sent: readonly string[]) => sent.map((raw) => JSON.parse(raw)).map((frame: { data: string }) => frame.data);

describe("createOutputRelay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Past the interval, so the first push of every test is treated as idle output.
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("sends the first chunk at once — a keystroke echo must not wait for a batch", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push("$ ");
    expect(outputs(s.sent)).toEqual(["$ "]);
  });

  it("batches the chunks that follow it into one frame", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push("a");
    relay.push("b");
    relay.push("c");
    expect(outputs(s.sent)).toEqual(["a"]); // b and c are still queued
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(outputs(s.sent)).toEqual(["a", "bc"]);
  });

  it("goes back to sending at once once the flood stops", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push("a");
    relay.push("b");
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS); // idle for longer than one interval
    relay.push("c");
    expect(outputs(s.sent)).toEqual(["a", "b", "c"]);
  });

  it("keeps every chunk in the replay buffer as it arrives, batched or not", () => {
    const entry = fakeEntry(fakeSocket().socket);
    const relay = createOutputRelay(entry, LIMIT);
    relay.push("a");
    relay.push("b");
    relay.push("c");
    expect(entry.buffer).toBe("abc"); // before any flush
  });

  it("flush() sends what is queued, so it can precede an exit frame", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push("a");
    relay.push("tail");
    relay.flush();
    expect(outputs(s.sent)).toEqual(["a", "tail"]);
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS); // the cancelled timer must not fire a second copy
    expect(outputs(s.sent)).toEqual(["a", "tail"]);
  });

  it("flush() on an empty queue sends nothing", () => {
    const s = fakeSocket();
    createOutputRelay(fakeEntry(s.socket), LIMIT).flush();
    expect(s.sent).toEqual([]);
  });

  it("discard() drops the queue — a reattach replays it from the buffer instead", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push("a");
    relay.push("queued");
    relay.discard();
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(outputs(s.sent)).toEqual(["a"]);
  });

  it("sends a batch to the socket the entry holds AT FLUSH, not the one it held at push", () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const entry = fakeEntry(first.socket);
    const relay = createOutputRelay(entry, LIMIT);
    relay.push("a");
    relay.push("during-reattach");
    entry.ws = second.socket as unknown as PtyEntry["ws"];
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(outputs(first.sent)).toEqual(["a"]);
    expect(outputs(second.sent)).toEqual(["during-reattach"]);
  });

  // A detached session keeps working, and its output keeps arriving. Queueing it would build
  // batches only to throw them away; the buffer is what a reattach replays.
  it("buffers but does not queue while no socket is attached", () => {
    const entry = fakeEntry(null);
    const relay = createOutputRelay(entry, LIMIT);
    relay.push("background ");
    relay.push("output");
    expect(entry.buffer).toBe("background output");
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    // Nothing was held, so a socket arriving later gets the replay — not a stale batch on top.
    const s = fakeSocket();
    entry.ws = s.socket as unknown as PtyEntry["ws"];
    relay.flush();
    expect(s.sent).toEqual([]);
  });

  // The queue only grows while the loop is too busy for the timer to fire, so nothing else
  // bounds how large one stringify-and-send gets.
  it("sends without waiting once the queue reaches the batch ceiling", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), 4 * 1024 * 1024);
    relay.push("first"); // idle: goes at once, and starts the batching window
    const chunk = "y".repeat(64 * 1024);
    for (let i = 0; i < 4; i++) relay.push(chunk); // 256 KiB, with no timer allowed to fire
    expect(outputs(s.sent)).toHaveLength(2);
    expect(outputs(s.sent)[1]).toHaveLength(4 * 64 * 1024);
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS); // the ceiling flush must leave nothing behind
    expect(outputs(s.sent)).toHaveLength(2);
  });

  it("bounds the buffer it grows, leaving the reader the exact cut", () => {
    const entry = fakeEntry(fakeSocket().socket);
    const relay = createOutputRelay(entry, 10);
    for (let i = 0; i < 100; i++) relay.push("0123456789");
    expect(entry.buffer.length).toBeLessThanOrEqual(12); // 10 * TAIL_SLACK
  });

  it("sends a terminal query immediately instead of delaying its reply round trip", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push("first");
    vi.advanceTimersByTime(1);
    relay.push(`${String.fromCharCode(0x1b)}[c`);
    expect(outputs(s.sent)).toEqual(["first", `${String.fromCharCode(0x1b)}[c`]);
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(outputs(s.sent)).toHaveLength(2);
  });

  it("recognises a terminal query split after its first half was already sent", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push(String.fromCharCode(0x1b) + "[");
    vi.advanceTimersByTime(1);
    relay.push("c");
    expect(outputs(s.sent)).toEqual([String.fromCharCode(0x1b) + "[", "c"]);
  });

  it("forgets a partial query when a reattach discards the old relay state", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    relay.push(String.fromCharCode(0x1b) + "[");
    relay.discard();
    vi.advanceTimersByTime(1);
    relay.push("c");
    expect(outputs(s.sent)).toEqual([String.fromCharCode(0x1b) + "["]);
    vi.advanceTimersByTime(FLUSH_INTERVAL_MS);
    expect(outputs(s.sent)).toEqual([String.fromCharCode(0x1b) + "[", "c"]);
  });

  it("keeps a second partial query after immediately sending a completed one", () => {
    const s = fakeSocket();
    const relay = createOutputRelay(fakeEntry(s.socket), LIMIT);
    const escape = String.fromCharCode(0x1b);
    relay.push(`first${escape}[6n${escape}[`);
    vi.advanceTimersByTime(1);
    relay.push("c");
    expect(outputs(s.sent)).toEqual([`first${escape}[6n${escape}[`, "c"]);
  });
});

describe("wireBufferedOutput", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  // node-pty's onData, reduced to the one thing this wiring needs from it.
  function fakePty() {
    let emit: ((data: string) => void) | undefined;
    const term = { onData: (fn: (data: string) => void) => (emit = fn) };
    return { term, feed: (data: string) => emit?.(data) };
  }

  const entryFor = (pty: ReturnType<typeof fakePty>, socket: ReturnType<typeof fakeSocket>["socket"]) =>
    ({ ws: socket, buffer: "", term: pty.term }) as unknown as PtyEntry;

  it("puts the relay where a reattach can find it, and forwards pty output through it", () => {
    const pty = fakePty();
    const s = fakeSocket();
    const entry = entryFor(pty, s.socket);
    const relay = wireBufferedOutput(entry, LIMIT);
    expect(entry.output).toBe(relay);
    pty.feed("hello");
    expect(outputs(s.sent)).toEqual(["hello"]);
    expect(entry.buffer).toBe("hello");
  });

  it("feeds the spawner's tap every chunk, unbatched — it scans the stream, it does not draw it", () => {
    const pty = fakePty();
    const seen: string[] = [];
    wireBufferedOutput(entryFor(pty, fakeSocket().socket), LIMIT, (data) => seen.push(data));
    pty.feed("a");
    pty.feed("b");
    pty.feed("c");
    expect(seen).toEqual(["a", "b", "c"]); // b and c are still queued for the browser
  });
});
