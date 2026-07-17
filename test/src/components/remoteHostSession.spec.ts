import { describe, it, expect, beforeEach, vi } from "vitest";
import { SESSION_KEY, loadStoredSession, persistSession, reconnectAction, type FetchResult } from "../../../src/components/remoteHostSession";

const okStatus = { connected: true, uid: "u1" };

describe("reconnectAction", () => {
  it("parks the blob on a successful reconnect (case 1)", () => {
    const res: FetchResult = { ok: true, status: okStatus, session: "blob-v2" };
    expect(reconnectAction(res)).toBe("park");
  });

  it("drops the blob on 401 — expired/invalid (case 2)", () => {
    const res: FetchResult = { ok: false, error: "expired", httpStatus: 401 };
    expect(reconnectAction(res)).toBe("drop");
  });

  it("keeps the blob on a transient 5xx (case 3)", () => {
    const res: FetchResult = { ok: false, error: "backend", httpStatus: 503 };
    expect(reconnectAction(res)).toBe("keep");
  });

  it("keeps the blob on a network failure (httpStatus 0)", () => {
    const res: FetchResult = { ok: false, error: "offline", httpStatus: 0 };
    expect(reconnectAction(res)).toBe("keep");
  });
});

describe("persistSession / loadStoredSession", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a blob and removes it on null", () => {
    persistSession("blob-1");
    expect(localStorage.getItem(SESSION_KEY)).toBe("blob-1");
    expect(loadStoredSession()).toBe("blob-1");
    persistSession(null);
    expect(loadStoredSession()).toBeNull();
  });

  it("degrades to no-op when localStorage throws (private mode)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => persistSession("x")).not.toThrow();
    spy.mockRestore();
  });
});
