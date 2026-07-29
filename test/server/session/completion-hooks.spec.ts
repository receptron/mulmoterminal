import { describe, it, expect, vi, afterEach } from "vitest";
import { registerCompletionHook, runCompletionHook, unregisterCompletionHook } from "../../../server/session/completion-hooks.js";

const A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

// The registry is module state shared across tests, so every id used here is dropped again.
afterEach(() => {
  unregisterCompletionHook(A);
  unregisterCompletionHook(B);
});

describe("runCompletionHook", () => {
  it("runs the registered hook with the outcome", async () => {
    const hook = vi.fn();
    registerCompletionHook(A, hook);
    await runCompletionHook(A, { didError: false });
    expect(hook).toHaveBeenCalledWith({ didError: false });
  });

  // ONE-SHOT is the contract the whole design rests on: the success and failure call sites
  // both fire unconditionally, and it is the drop-after-run that makes the FIRST answer win.
  it("runs a hook only once, however many times it is fired", async () => {
    const hook = vi.fn();
    registerCompletionHook(A, hook);
    await runCompletionHook(A, { didError: false });
    await runCompletionHook(A, { didError: true });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  // The rule that keeps a successful refresh from being reported as failed: a finished turn
  // (Stop) reports success, and the teardown of that same session comes along afterwards.
  it("does not let the reap's failure overwrite a finished turn's success", async () => {
    const outcomes: boolean[] = [];
    registerCompletionHook(A, ({ didError }) => void outcomes.push(didError));
    await runCompletionHook(A, { didError: false }); // Stop
    await runCompletionHook(A, { didError: true }); // reap, later
    expect(outcomes).toEqual([false]);
  });

  // The other order is the failure path: nothing reported success, so teardown gets to.
  it("reports failure when teardown is the first thing to fire", async () => {
    const outcomes: boolean[] = [];
    registerCompletionHook(A, ({ didError }) => void outcomes.push(didError));
    await runCompletionHook(A, { didError: true }); // reaped without ever reaching Stop
    expect(outcomes).toEqual([true]);
  });

  it("is a no-op for a session with no hook", async () => {
    await expect(runCompletionHook(B, { didError: true })).resolves.toBeUndefined();
  });

  it("keeps each session's hook to itself", async () => {
    const first = vi.fn();
    const second = vi.fn();
    registerCompletionHook(A, first);
    registerCompletionHook(B, second);
    await runCompletionHook(A, { didError: false });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("lets the last registration for an id win", async () => {
    const replaced = vi.fn();
    const winner = vi.fn();
    registerCompletionHook(A, replaced);
    registerCompletionHook(A, winner);
    await runCompletionHook(A, { didError: false });
    expect(replaced).not.toHaveBeenCalled();
    expect(winner).toHaveBeenCalledTimes(1);
  });

  it("does not fire after unregister", async () => {
    const hook = vi.fn();
    registerCompletionHook(A, hook);
    unregisterCompletionHook(A);
    await runCompletionHook(A, { didError: false });
    expect(hook).not.toHaveBeenCalled();
  });

  // The id selects which stored closure gets called, so a malformed one must never reach the
  // map — on either side of the seam.
  it("ignores ids that are not canonical session ids", async () => {
    const hook = vi.fn();
    registerCompletionHook("../../etc/passwd", hook);
    await runCompletionHook("../../etc/passwd", { didError: true });
    expect(hook).not.toHaveBeenCalled();
  });

  it("rejects rather than swallowing a throwing hook, and still drops it", async () => {
    registerCompletionHook(A, () => {
      throw new Error("boom");
    });
    await expect(runCompletionHook(A, { didError: false })).rejects.toThrow("boom");
    // Dropped before the call, so a thrower cannot be re-run by the next fire.
    await expect(runCompletionHook(A, { didError: true })).resolves.toBeUndefined();
  });

  it("awaits an async hook before resolving", async () => {
    let settled = false;
    registerCompletionHook(A, async () => {
      await Promise.resolve();
      settled = true;
    });
    await runCompletionHook(A, { didError: false });
    expect(settled).toBe(true);
  });
});
