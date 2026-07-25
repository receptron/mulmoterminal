// @vitest-environment node
import { describe, it, expect } from "vitest";

import { createSessionChain } from "./sessionChain.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A task that only finishes when the test says so, recording when it started.
const gate = (log: string[], name: string) => {
  let release: () => void = () => undefined;
  const task = () => {
    log.push(`start ${name}`);
    return new Promise<string>((resolve) => {
      release = () => {
        log.push(`end ${name}`);
        resolve(name);
      };
    });
  };
  return { task, release: () => release() };
};

describe("createSessionChain", () => {
  it("runs one task at a time per session", async () => {
    const inOrder = createSessionChain();
    const log: string[] = [];
    const first = gate(log, "first");
    const second = gate(log, "second");
    const a = inOrder("s1", first.task);
    const b = inOrder("s1", second.task);
    await tick();
    // The second must not have started while the first is unfinished.
    expect(log).toEqual(["start first"]);
    first.release();
    await a;
    await tick();
    expect(log).toEqual(["start first", "end first", "start second"]);
    second.release();
    await expect(b).resolves.toBe("second");
  });

  it("does not make one session wait on another", async () => {
    const inOrder = createSessionChain();
    const log: string[] = [];
    const one = gate(log, "one");
    const two = gate(log, "two");
    const a = inOrder("s1", one.task);
    const b = inOrder("s2", two.task);
    await tick();
    expect(log).toEqual(["start one", "start two"]);
    one.release();
    two.release();
    await expect(Promise.all([a, b])).resolves.toEqual(["one", "two"]);
  });

  it("hands the task's result and error to the caller", async () => {
    const inOrder = createSessionChain();
    await expect(inOrder("s1", async () => 42)).resolves.toBe(42);
    await expect(inOrder("s1", async () => Promise.reject(new Error("nope")))).rejects.toThrow(/nope/);
  });

  // A rejected task must not wedge the session for every later one.
  it("keeps the chain alive after a failure", async () => {
    const inOrder = createSessionChain();
    await expect(inOrder("s1", async () => Promise.reject(new Error("boom")))).rejects.toThrow(/boom/);
    await expect(inOrder("s1", async () => "after")).resolves.toBe("after");
  });

  // The rejection is delivered to the caller and swallowed inside the chain; nothing must
  // reach process-level unhandledRejection.
  it("does not leave an unhandled rejection behind", async () => {
    const inOrder = createSessionChain();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(inOrder("s1", async () => Promise.reject(new Error("boom")))).rejects.toThrow(/boom/);
      await tick();
      await tick();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  // Sessions come and go by the hundred over a host's uptime, so the map must not keep an
  // entry per session id it has ever seen.
  it("forgets a session once its last task is done", async () => {
    const chains = new Map<string, Promise<void>>();
    const inOrder = createSessionChain(chains);
    await inOrder("s1", async () => "done");
    await tick();
    expect(chains.size).toBe(0);
  });

  it("keeps the entry while a task is still queued behind another", async () => {
    const chains = new Map<string, Promise<void>>();
    const inOrder = createSessionChain(chains);
    const log: string[] = [];
    const first = gate(log, "first");
    const a = inOrder("s1", first.task);
    const b = inOrder("s1", async () => "second");
    await tick();
    expect(chains.size).toBe(1);
    first.release();
    await Promise.all([a, b]);
    await tick();
    expect(chains.size).toBe(0);
  });

  it("forgets a failed session too", async () => {
    const chains = new Map<string, Promise<void>>();
    const inOrder = createSessionChain(chains);
    await expect(inOrder("s1", async () => Promise.reject(new Error("boom")))).rejects.toThrow(/boom/);
    await tick();
    expect(chains.size).toBe(0);
  });
});
