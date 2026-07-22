// @vitest-environment node
//
// The stateful half of session teardown: it holds timers and calls things in an order that
// matters. The DECISIONS it consults (reapDecisionFor, shouldForgetActivity, nextActivity)
// have their own specs; what is exercised here is the orchestration that used to be
// unreachable without booting the server.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSessionLifecycle } from "../../../server/session/lifecycle.js";
import { activity, aiTitles, hiddenSessions, knownSessions, lastPrompts, lastResponses, launchChoices, ptys } from "../../../server/session/registry.js";

vi.mock("../../../server/infra/tmux.js", () => ({ tmuxKillSession: vi.fn() }));
vi.mock("../../../server/infra/sandbox.js", () => ({ cleanupSandbox: vi.fn() }));
vi.mock("../../../server/session/session-settings.js", () => ({ cleanupSessionSettings: vi.fn() }));

const ID = "11111111-2222-4333-8444-555555555555";

const makeDeps = () => ({
  publish: vi.fn(),
  forgetTitle: vi.fn(),
  sessionActivityPublisher: { publish: vi.fn(), forget: vi.fn() },
});

// A pty entry with just the fields the lifecycle reads.
const fakeEntry = (over: Record<string, unknown> = {}) => ({ term: { kill: vi.fn() }, ws: null, cwd: "/work", tmux: false, ...over }) as never;

const clearRegistry = () => {
  for (const map of [ptys, activity, knownSessions, lastPrompts, lastResponses, aiTitles, launchChoices]) map.clear();
  hiddenSessions.clear();
};

beforeEach(clearRegistry);
afterEach(() => {
  vi.useRealTimers();
  clearRegistry();
});

describe("reap", () => {
  it("removes every trace of the session", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    knownSessions.set(ID, { createdAt: 1, title: "t" });
    lastPrompts.set(ID, "p");
    lastResponses.set(ID, "r");
    launchChoices.set(ID, { provider: "openrouter", model: "m" });

    createSessionLifecycle(deps).reap(ID);

    // A leak here is a session that lingers in the sidebar, or a provider token's settings
    // file left on disk.
    expect([ptys.has(ID), knownSessions.has(ID), lastPrompts.has(ID), lastResponses.has(ID), launchChoices.has(ID)]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(deps.forgetTitle).toHaveBeenCalledWith(ID);
    expect(deps.sessionActivityPublisher.forget).toHaveBeenCalledWith(ID);
  });

  it("kills the pty and tells subscribers the session closed", () => {
    const deps = makeDeps();
    const entry = fakeEntry();
    ptys.set(ID, entry);
    createSessionLifecycle(deps).reap(ID);
    expect((entry as { term: { kill: ReturnType<typeof vi.fn> } }).term.kill).toHaveBeenCalled();
    expect(deps.publish).toHaveBeenCalledWith("sessions", expect.objectContaining({ id: ID, working: false, event: "closed" }));
  });

  it("does nothing for a session that was already reaped", () => {
    const deps = makeDeps();
    createSessionLifecycle(deps).reap(ID);
    expect(deps.publish).not.toHaveBeenCalled();
  });

  // The bold-until-viewed behaviour: a finished background session keeps its activity record
  // so it stays flagged for the user, while an idle one is dropped to bound the map.
  it("keeps a waiting session's activity record but drops an idle one's", () => {
    const deps = makeDeps();
    const lifecycle = createSessionLifecycle(deps);

    ptys.set(ID, fakeEntry());
    activity.set(ID, { working: false, waiting: true, event: "Notification", at: 1 });
    lifecycle.reap(ID);
    expect(activity.has(ID)).toBe(true);

    activity.set(ID, { working: false, waiting: false, event: "Stop", at: 1 });
    ptys.set(ID, fakeEntry());
    lifecycle.reap(ID);
    expect(activity.has(ID)).toBe(false);
  });
});

describe("setWorking / setWaiting", () => {
  it("publishes a row when the flag actually changes", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(deps).setWorking(ID, true, "UserPromptSubmit");
    expect(activity.get(ID)?.working).toBe(true);
    expect(deps.publish).toHaveBeenCalled();
  });

  // Every hook fires these; publishing an unchanged row would flood the socket.
  it("stays silent when the flag is unchanged", () => {
    const deps = makeDeps();
    const lifecycle = createSessionLifecycle(deps);
    ptys.set(ID, fakeEntry({ ws: {} }));
    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    deps.publish.mockClear();
    lifecycle.setWorking(ID, true, "UserPromptSubmit");
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("mirrors the flags to the phone", () => {
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(deps).setWaiting(ID, true, "Notification");
    expect(deps.sessionActivityPublisher.publish).toHaveBeenCalledWith(ID, { working: false, waiting: true });
  });
});

describe("the reap timer", () => {
  // A session the user is looking at must never be reaped out from under them.
  // Two independent guards protect an attached session: arming skips it, and the timer
  // re-checks when it fires. Asserting only "the session survived" cannot tell them apart —
  // removing either one alone still leaves it alive. So this asserts the arming guard
  // directly, by observing that no timer was created at all.
  it("does not arm anything while a client is attached", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry({ ws: {} }));
    activity.set(ID, { working: false, waiting: false, event: "Stop", at: 1 });
    createSessionLifecycle(deps).armReapForDetached(ID);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60 * 60_000);
    expect(ptys.has(ID)).toBe(true);
  });

  // "Clearly working — don't close it."
  it("keeps a detached session that is still working", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    activity.set(ID, { working: true, waiting: false, event: "UserPromptSubmit", at: 1 });
    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(60 * 60_000);
    expect(ptys.has(ID)).toBe(true);
  });

  it("reaps a detached idle session after the short grace", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    createSessionLifecycle(deps).armReapForDetached(ID);
    vi.advanceTimersByTime(29_000);
    expect(ptys.has(ID)).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(ptys.has(ID)).toBe(false);
  });

  // A reattach within the window is the whole point: a page reload must not cost the session.
  it("cancels a pending reap", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const lifecycle = createSessionLifecycle(deps);
    ptys.set(ID, fakeEntry());
    lifecycle.armReapForDetached(ID);
    lifecycle.cancelReap(ID);
    vi.advanceTimersByTime(60 * 60_000);
    expect(ptys.has(ID)).toBe(true);
  });

  // The timer fires on a session that has since reattached — it must check again, not reap.
  it("does not reap a session that reattached during the grace", () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    ptys.set(ID, fakeEntry());
    createSessionLifecycle(deps).armReapForDetached(ID);
    ptys.set(ID, fakeEntry({ ws: {} })); // the user came back
    vi.advanceTimersByTime(60_000);
    expect(ptys.has(ID)).toBe(true);
  });
});
