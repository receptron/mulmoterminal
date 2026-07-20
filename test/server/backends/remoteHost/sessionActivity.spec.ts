// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { createSessionActivityPublisher, type SessionActivityStore } from "../../../../server/backends/remoteHost/sessionActivity.js";

const UID = "user-1";
const HOST = "mulmoterminal";

const recorder = () => {
  const writes: Array<{ sessionId: string; rev: number; working: boolean; waiting: boolean }> = [];
  const removes: string[] = [];
  const store: SessionActivityStore = {
    write: async (_uid, _hostId, sessionId, payload) => {
      writes.push({ sessionId, rev: payload.rev, working: payload.working, waiting: payload.waiting });
    },
    remove: async (_uid, _hostId, sessionId) => {
      removes.push(sessionId);
    },
  };
  return { writes, removes, store };
};

const publisher = (store: SessionActivityStore, uid: () => string | null = () => UID, onError = vi.fn()) =>
  createSessionActivityPublisher({ uid, hostId: HOST, store, onError });

describe("createSessionActivityPublisher", () => {
  it("writes a transition with the state that changed", () => {
    const { writes, store } = recorder();
    publisher(store).publish("s1", { working: true, waiting: false });
    expect(writes).toEqual([{ sessionId: "s1", rev: 1, working: true, waiting: false }]);
  });

  // The host's publishActivity is not only called on transitions — generating an AI
  // title or clearing the header republishes an unchanged pair. Those must not bill a
  // write, nor wake a watching phone into refetching an unchanged screen.
  it("ignores a republished snapshot that did not change", () => {
    const { writes, store } = recorder();
    const activity = publisher(store);
    activity.publish("s1", { working: true, waiting: false });
    activity.publish("s1", { working: true, waiting: false });
    activity.publish("s1", { working: true, waiting: false });
    expect(writes).toHaveLength(1);
  });

  it("writes again once the state really changes", () => {
    const { writes, store } = recorder();
    const activity = publisher(store);
    activity.publish("s1", { working: true, waiting: false });
    activity.publish("s1", { working: false, waiting: true });
    expect(writes.map((entry) => entry.rev)).toEqual([1, 2]);
    expect(writes.at(-1)).toMatchObject({ working: false, waiting: true });
  });

  it("counts revisions per session, not globally", () => {
    const { writes, store } = recorder();
    const activity = publisher(store);
    activity.publish("s1", { working: true, waiting: false });
    activity.publish("s2", { working: true, waiting: false });
    expect(writes.map((entry) => [entry.sessionId, entry.rev])).toEqual([
      ["s1", 1],
      ["s2", 1],
    ]);
  });

  // currentUid() is null while the remote host is disconnected, and it is the guard
  // that makes the store's currentFirestore() safe — that accessor throws when there
  // is no session.
  it("does nothing while the remote host is disconnected", () => {
    const { writes, removes, store } = recorder();
    const activity = publisher(store, () => null);
    activity.publish("s1", { working: true, waiting: false });
    activity.forget("s1");
    expect(writes).toEqual([]);
    expect(removes).toEqual([]);
  });

  it("removes the doc when a session is reaped", () => {
    const { removes, store } = recorder();
    const activity = publisher(store);
    activity.publish("s1", { working: true, waiting: false });
    activity.forget("s1");
    expect(removes).toEqual(["s1"]);
  });

  // A reused id must not inherit the previous session's dedup key, or its first real
  // state would be swallowed as "unchanged".
  it("starts a reused session id from a clean slate", () => {
    const { writes, store } = recorder();
    const activity = publisher(store);
    activity.publish("s1", { working: true, waiting: false });
    activity.forget("s1");
    activity.publish("s1", { working: true, waiting: false });
    expect(writes).toHaveLength(2);
    expect(writes.at(-1)?.rev).toBe(1);
  });

  // The caller sits on the synchronous hook path serving Claude Code's own requests.
  it("reports a failed write without throwing at the caller", async () => {
    const onError = vi.fn();
    const failing: SessionActivityStore = {
      write: async () => {
        throw new Error("offline");
      },
      remove: async () => undefined,
    };
    expect(() => publisher(failing, () => UID, onError).publish("s1", { working: true, waiting: false })).not.toThrow();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
  });

  // Dedup is recorded optimistically, so without releasing it on failure a lost write
  // would swallow every later publish of the SAME state and strand the phone until
  // some different transition happened.
  it("retries the same state after a failed write", async () => {
    const onError = vi.fn();
    const attempts: number[] = [];
    const flaky: SessionActivityStore = {
      write: async (_uid, _hostId, _sessionId, payload) => {
        attempts.push(payload.rev);
        if (attempts.length === 1) throw new Error("offline");
      },
      remove: async () => undefined,
    };
    const activity = publisher(flaky, () => UID, onError);
    activity.publish("s1", { working: true, waiting: false });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    activity.publish("s1", { working: true, waiting: false });
    expect(attempts).toEqual([1, 2]);
  });

  // Rolling back blindly would resurrect a state the session has already left.
  it("does not resurrect a state a newer publish superseded", async () => {
    const onError = vi.fn();
    const written: Array<{ working: boolean; waiting: boolean }> = [];
    const failFirst: SessionActivityStore = {
      write: async (_uid, _hostId, _sessionId, payload) => {
        written.push({ working: payload.working, waiting: payload.waiting });
        if (written.length === 1) throw new Error("offline");
      },
      remove: async () => undefined,
    };
    const activity = publisher(failFirst, () => UID, onError);
    activity.publish("s1", { working: true, waiting: false });
    activity.publish("s1", { working: false, waiting: true });
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    activity.publish("s1", { working: false, waiting: true });
    expect(written).toEqual([
      { working: true, waiting: false },
      { working: false, waiting: true },
    ]);
  });
});
