import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { probeOnce, waitUntilReady } from "../../bin/wait-ready.js";

type FakeReq = EventEmitter & { destroy: () => void; destroyed: boolean };

// A fake ClientRequest that lets a test drive error / timeout / response, and records
// whether destroy() was called. Mirrors the http.ClientRequest surface probeOnce uses.
function fakeReq(): FakeReq {
  const req = new EventEmitter() as FakeReq;
  req.destroyed = false;
  req.destroy = () => {
    req.destroyed = true;
    // Node emits 'error' ("socket hang up") when you destroy an in-flight request — the
    // exact behavior that used to double-fire the retry.
    req.emit("error", new Error("socket hang up"));
  };
  return req;
}

describe("probeOnce", () => {
  it("resolves 'ready' when the server answers", async () => {
    const req = fakeReq();
    const get = vi.fn((_opts: unknown, cb: (res: { resume(): void }) => void) => {
      queueMicrotask(() => cb({ resume() {} }));
      return req;
    });
    expect(await probeOnce(get, 3000)).toBe("ready");
  });

  it("resolves 'retry' on a connection error", async () => {
    const req = fakeReq();
    const get = vi.fn(() => {
      queueMicrotask(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    });
    expect(await probeOnce(get, 3000)).toBe("retry");
  });

  // Regression (#747): a timeout calls req.destroy(), which itself emits 'error'. Without
  // the settled latch that produced TWO outcomes (two retries) from one probe, forking the
  // poll loop. probeOnce must resolve exactly once.
  it("yields a single 'retry' on timeout even though destroy() also emits 'error'", async () => {
    const req = fakeReq();
    const get = vi.fn(() => {
      queueMicrotask(() => req.emit("timeout"));
      return req;
    });
    const resolved = vi.fn();
    const p = probeOnce(get, 3000).then(resolved);
    await p;
    // Give any stray error-driven resolution a chance to (wrongly) fire.
    await new Promise((r) => setTimeout(r, 5));
    expect(req.destroyed).toBe(true);
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveBeenCalledWith("retry");
  });
});

describe("waitUntilReady", () => {
  it("calls onReady exactly once after retries, never forking on a timeout", async () => {
    let calls = 0;
    // First probe times out (fires timeout + destroy's error), then the server answers.
    const get = vi.fn((_opts: unknown, cb: (res: { resume(): void }) => void) => {
      const req = fakeReq();
      calls += 1;
      if (calls === 1) queueMicrotask(() => req.emit("timeout"));
      else queueMicrotask(() => cb({ resume() {} }));
      return req;
    });
    const onReady = vi.fn();
    waitUntilReady(3000, onReady, { get, intervalMs: 1, readyTimeoutMs: 5000 });
    await vi.waitFor(() => expect(onReady).toHaveBeenCalled(), { timeout: 1000 });
    await new Promise((r) => setTimeout(r, 20)); // let any fork try to fire again
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("gives up after readyTimeoutMs without calling onReady", async () => {
    const get = vi.fn(() => {
      const req = fakeReq();
      queueMicrotask(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    });
    const onReady = vi.fn();
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(10_000); // immediately past the deadline
    waitUntilReady(3000, onReady, { get, intervalMs: 1, readyTimeoutMs: 5000, now });
    await new Promise((r) => setTimeout(r, 20));
    expect(onReady).not.toHaveBeenCalled();
  });

  it("stops polling once cancelled", async () => {
    const get = vi.fn(() => {
      const req = fakeReq();
      queueMicrotask(() => req.emit("error", new Error("ECONNREFUSED")));
      return req;
    });
    const onReady = vi.fn();
    const cancel = waitUntilReady(3000, onReady, { get, intervalMs: 1, readyTimeoutMs: 5000 });
    cancel();
    const before = get.mock.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(get.mock.calls.length).toBeLessThanOrEqual(before + 1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
