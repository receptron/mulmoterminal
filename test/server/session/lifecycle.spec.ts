// @vitest-environment node
//
// The stateful half of session teardown: it holds timers and calls things in an order that
// matters. The DECISIONS it consults (reapDecisionFor, shouldForgetActivity, nextActivity)
// have their own specs; what is exercised here is the orchestration that used to be
// unreachable without booting the server.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSessionLifecycle } from "../../../server/session/lifecycle.js";
import type { WorkPhase } from "../../../server/session/workPhase.js";
import { activity, aiTitles, hiddenSessions, knownSessions, lastPrompts, lastResponses, launchChoices, ptys } from "../../../server/session/registry.js";
import { clearedTranscripts } from "../../../server/session/cleared-transcripts.js";

vi.mock("../../../server/infra/tmux.js", () => ({ tmuxKillSession: vi.fn() }));
vi.mock("../../../server/infra/sandbox.js", () => ({ cleanupSandbox: vi.fn() }));
vi.mock("../../../server/session/session-settings.js", () => ({ cleanupSessionSettings: vi.fn() }));
// The reply the roster shows is re-read from the transcript at the end of a turn; the tests
// stand in for that file so the refresh can be observed without writing one.
vi.mock("../../../server/session/session-reads.js", () => ({ readLatestResponse: vi.fn(() => "the reply on disk") }));

const ID = "11111111-2222-4333-8444-555555555555";

const makeDeps = (workPhase: WorkPhase | null = null) => ({
  publish: vi.fn(),
  forgetTitle: vi.fn(),
  sessionActivityPublisher: { publish: vi.fn(), forget: vi.fn() },
  workPhaseOf: vi.fn(() => workPhase),
  forgetWorkPhase: vi.fn(),
});

// A pty entry with just the fields the lifecycle reads.
const fakeEntry = (over: Record<string, unknown> = {}) => ({ term: { kill: vi.fn() }, ws: null, cwd: "/work", tmux: false, ...over }) as never;

const clearRegistry = () => {
  for (const map of [ptys, activity, knownSessions, lastPrompts, lastResponses, aiTitles, launchChoices]) map.clear();
  hiddenSessions.clear();
  clearedTranscripts.clear();
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

  // The mark says "our transcript is frozen on a conversation that ended". Teardown is where
  // that stops being true: the next claude on this id appends to that file again (#1085).
  it("stops treating the transcript as cleared", () => {
    ptys.set(ID, fakeEntry());
    clearedTranscripts.add(ID);
    createSessionLifecycle(makeDeps()).reap(ID);
    expect(clearedTranscripts.has(ID)).toBe(false);
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

  // The phone renders the same status vocabulary as the cockpit roster, which needs the event
  // (blocked vs done) and the live work phase (planning vs editing) alongside the flags (#727).
  it("mirrors the flags, the event and the work phase to the phone", () => {
    const deps = makeDeps("implementing");
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(deps).setWaiting(ID, true, "Notification");
    expect(deps.sessionActivityPublisher.publish).toHaveBeenCalledWith(ID, {
      working: false,
      waiting: true,
      event: "Notification",
      workPhase: "implementing",
    });
  });
});

// The end of a turn is when the roster's copy of the reply is refreshed from the transcript —
// and, after a /clear, the moment the pre-clear reply used to come back (#1085). The rule itself
// is shouldRefreshReply's; what is pinned here is that the lifecycle actually asks it about THIS
// session, since passing a constant would read as working right up to the clear.
describe("publishActivity's reply refresh", () => {
  const endATurn = () => {
    ptys.set(ID, fakeEntry({ ws: {} }));
    createSessionLifecycle(makeDeps()).setWaiting(ID, true, "Stop");
  };

  it("re-reads the transcript when a turn ends", () => {
    endATurn();
    expect(lastResponses.get(ID)).toBe("the reply on disk");
  });

  it("leaves a cleared session's blank reply alone", () => {
    lastResponses.set(ID, ""); // what /clear writes
    clearedTranscripts.add(ID);
    endATurn();
    expect(lastResponses.get(ID)).toBe("");
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
