// @vitest-environment node
import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import { askChildToStop, installParentShutdown, isShutdownMessage, type StoppableChild, type SupervisedChild } from "../../bin/child-shutdown.js";

describe("isShutdownMessage", () => {
  it("accepts the request", () => {
    expect(isShutdownMessage({ type: "shutdown" })).toBe(true);
  });

  it.each([[{ type: "listening" }], ["shutdown"], [{ kind: "shutdown" }], [null], [undefined], [42], [{ type: undefined }]])("refuses %j", (message) => {
    expect(isShutdownMessage(message)).toBe(false);
  });
});

// A fake child whose `send` reports a given outcome to its callback, as Node's does.
function child({ connected, sendError = null }: { connected: boolean; sendError?: Error | null }) {
  const fake: StoppableChild = {
    connected,
    send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
      callback(sendError);
      return sendError === null;
    }),
    kill: vi.fn(() => true),
  };
  return fake;
}

// #3234. A signal to another process is TerminateProcess on Windows, so the request has to travel
// over the channel whenever there is one — and still reach a child that has none.
describe("askChildToStop", () => {
  it("asks over the channel and sends no signal", () => {
    const fake = child({ connected: true });
    askChildToStop(fake);
    expect(fake.send).toHaveBeenCalledWith({ type: "shutdown" }, expect.any(Function));
    expect(fake.kill).not.toHaveBeenCalled();
  });

  it("falls back to a signal when the message cannot be delivered", () => {
    const fake = child({ connected: true, sendError: new Error("channel closed") });
    askChildToStop(fake);
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("signals a child that has no channel", () => {
    const fake = child({ connected: false });
    askChildToStop(fake);
    expect(fake.send).not.toHaveBeenCalled();
    expect(fake.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

// A child process as far as the parent's shutdown looks at one: alive, with a channel, and able to
// emit `close`.
function liveChild() {
  const send = vi.fn((_message: unknown, callback: (error: Error | null) => void) => {
    callback(null);
    return true;
  });
  const kill = vi.fn(() => true);
  const emitter = new EventEmitter();
  const proc: SupervisedChild = {
    exitCode: null,
    signalCode: null,
    connected: true,
    send,
    kill,
    once: (event, listener) => emitter.once(event, listener),
  };
  return { proc, send, kill, close: () => emitter.emit("close") };
}

function installed(proc: SupervisedChild | null, graceMs = 1000) {
  const listeners = new Map<string, () => void>();
  const exit = vi.fn();
  const onStopping = vi.fn();
  installParentShutdown(() => proc, { graceMs, exit, onStopping, on: (signal, listener) => listeners.set(signal, listener) });
  const signal = (name: NodeJS.Signals) => listeners.get(name)?.();
  return { exit, onStopping, signal };
}

describe("installParentShutdown", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["SIGINT", "SIGTERM"] as const)("on %s asks the child over the channel and waits for it to close", (name) => {
    const { proc, send, kill, close } = liveChild();
    const { exit, onStopping, signal } = installed(proc);
    signal(name);
    expect(send).toHaveBeenCalledWith({ type: "shutdown" }, expect.any(Function));
    expect(kill).not.toHaveBeenCalled();
    expect(onStopping).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    close();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("kills a child that has not closed by the cap, and goes", () => {
    vi.useFakeTimers();
    const { proc, kill, close } = liveChild();
    const { exit, signal } = installed(proc, 500);
    signal("SIGINT");
    vi.advanceTimersByTime(499);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(exit).toHaveBeenCalledWith(0);
    // The killed child still closes afterwards; that must not count as a second ending.
    close();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("stops waiting on a second Ctrl+C", () => {
    const { proc } = liveChild();
    const { exit, signal } = installed(proc);
    signal("SIGINT");
    signal("SIGINT");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("goes at once when there is no child, or it has already ended", () => {
    expect(
      (() => {
        const { exit, signal } = installed(null);
        signal("SIGINT");
        return exit.mock.calls;
      })(),
    ).toEqual([[0]]);
    const { proc, send } = liveChild();
    proc.exitCode = 1;
    const { exit, onStopping, signal } = installed(proc);
    signal("SIGINT");
    expect(exit).toHaveBeenCalledWith(0);
    expect(send).not.toHaveBeenCalled();
    expect(onStopping).not.toHaveBeenCalled();
  });
});
