// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock is hoisted above every const in the file, so the spy has to be hoisted with it.
const { stopWhisperSidecar, drainPersistQueues } = vi.hoisted(() => ({ stopWhisperSidecar: vi.fn(), drainPersistQueues: vi.fn(async () => true) }));
vi.mock("../../../../server/backends/media/whisper.js", () => ({ stopWhisperSidecar }));
vi.mock("../../../../server/session/reaping/persist-drain.js", () => ({ drainPersistQueues }));

import { installShutdownHandlers, requestShutdown } from "../../../../server/infra/process/shutdown.js";

// Registering a signal listener is what SUPPRESSES Node's own termination, so a signal this module
// forgets is a MulmoTerminal that no longer dies from Ctrl+C. That failure is invisible to every
// other test — nothing else sends the process a signal — which is the reason for this file.
//
// `process.once` is spied rather than the real listeners diffed: the handlers call process.exit, so
// leaving one attached would end the test run, and the registration is the thing being asserted.
type OnceArgs = Parameters<typeof process.once>;

// The exit is asynchronous now (#2161), and the listener returns void — a promise there is what
// `no-misused-promises` forbids. So the observation is a flush, and it has to be a MACROtask one:
// a single microtask is not enough to let a drain plus its `.then` land, which is how a sibling
// spec passed against a mutation that drained only the first queue.
const settleEverythingPending = () => new Promise<void>((resolve) => setImmediate(resolve));

const SIGNALS = ["SIGINT", "SIGTERM"] as const;

describe("installShutdownHandlers", () => {
  let registered: OnceArgs[] = [];
  // The parent's IPC channel. A stand-in, because the real one in a vitest worker is vitest's.
  let channel = new EventEmitter();

  beforeEach(() => {
    registered = [];
    stopWhisperSidecar.mockClear();
    drainPersistQueues.mockClear();
    drainPersistQueues.mockImplementation(async () => true);
    vi.spyOn(process, "once").mockImplementation((...args: OnceArgs) => {
      registered.push(args);
      return process;
    });
    channel = new EventEmitter();
    installShutdownHandlers(channel);
  });

  afterEach(() => vi.restoreAllMocks());

  const listenerFor = (event: string): OnceArgs[1] | undefined => registered.find(([e]) => e === event)?.[1];

  it.each(SIGNALS)("takes over termination for %s", (signal) => {
    expect(registered.filter(([e]) => e === signal)).toHaveLength(1);
  });

  it("stops the sidecar on a normal return, where no signal is involved", () => {
    const onExit = listenerFor("exit");
    expect(onExit).toBeDefined();
    onExit?.(0);
    expect(stopWhisperSidecar).toHaveBeenCalledTimes(1);
  });

  // The exit is ASYNC now — the handler drains queued session state before going (#2161) — so the
  // listener's promise has to be awaited. Calling it and asserting immediately is what this test
  // used to do, and it would now pass only by accident of timing.
  it.each(SIGNALS)("kills the sidecar and exits 0 on %s, because the default exit is suppressed", async (signal) => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listenerFor(signal)?.(signal);
    await settleEverythingPending();
    expect(stopWhisperSidecar).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  // The exit must not become conditional on the sidecar behaving. Before the drain this function
  // was two statements, and a throw took the process down anyway; now it would reject a promise
  // nobody awaits and leave a process whose default termination is suppressed — one that ignores
  // Ctrl+C entirely.
  // `process.exit` emits `exit`, whose listener is the same cleanup — so without a guard a sidecar
  // that throws deterministically throws AGAIN from inside the exit handler and prints an uncaught
  // stack on the way out. Stopping it once is what makes the warning the whole story.
  it("stops the sidecar at most once across the signal path and the exit listener", async () => {
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listenerFor("SIGINT")?.("SIGINT");
    await settleEverythingPending();
    listenerFor("exit")?.(0);
    expect(stopWhisperSidecar).toHaveBeenCalledTimes(1);
  });

  it.each(SIGNALS)("still exits on %s when stopping the sidecar throws", async (signal) => {
    stopWhisperSidecar.mockImplementationOnce(() => {
      throw new Error("sidecar wedged");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listenerFor(signal)?.(signal);
    await settleEverythingPending();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("registers each of the three exactly once, so a second call cannot stack listeners", () => {
    expect(registered.map(([e]) => e)).toEqual(["exit", ...SIGNALS]);
  });

  // The reason this whole PR exists, and nothing else pins it: removing `await
  // drainPersistQueues()` from the exit path left every other test in this file green. Queued
  // session state is lost silently when that happens — there is no crash and no red suite, which
  // is exactly how it went unnoticed until #2161.
  it.each(SIGNALS)("drains queued session state before exiting on %s", async (signal) => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listenerFor(signal)?.(signal);
    await settleEverythingPending();
    expect(drainPersistQueues).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  // ...and it must drain BEFORE it exits, not alongside. A drain the exit does not wait for is
  // the same bug wearing a function call.
  it("does not exit until the drain has settled", async () => {
    let releaseDrain: () => void = () => {};
    drainPersistQueues.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseDrain = () => resolve(true);
        }),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    listenerFor("SIGINT")?.("SIGINT");
    await settleEverythingPending();
    expect(exit).not.toHaveBeenCalled();

    releaseDrain();
    await settleEverythingPending();
    expect(exit).toHaveBeenCalledWith(0);
  });

  // Losing the tail is the lesser failure, but it must not be a SILENT one: an operator needs to
  // be able to tell a clean stop from a truncated one.
  it("says so when the cap fires instead of exiting quietly", async () => {
    drainPersistQueues.mockImplementationOnce(async () => false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listenerFor("SIGINT")?.("SIGINT");
    await settleEverythingPending();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lost"));
  });

  // #3234. On Windows a parent's signal is TerminateProcess, so the launcher and `yarn dev` ask over
  // the channel instead — and that request has to run the very same drain-then-exit.
  it("runs the same drain and exit when a parent asks over the channel", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    channel.emit("message", { type: "shutdown" });
    await settleEverythingPending();
    expect(stopWhisperSidecar).toHaveBeenCalledTimes(1);
    expect(drainPersistQueues).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it.each([[{ type: "listening" }], ["shutdown"], [null], [{}]])("ignores a message that is not the request: %j", async (message) => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    channel.emit("message", message);
    await settleEverythingPending();
    expect(drainPersistQueues).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  // One Ctrl+C on POSIX arrives twice — the terminal signals the whole group, and the launcher
  // also sends its message — and the browser's button can race a Ctrl+C. Each must drain once.
  it("drains once however many ways the stop is asked for", async () => {
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    listenerFor("SIGINT")?.("SIGINT");
    channel.emit("message", { type: "shutdown" });
    requestShutdown();
    listenerFor("SIGTERM")?.("SIGTERM");
    await settleEverythingPending();
    expect(drainPersistQueues).toHaveBeenCalledTimes(1);
  });
});
