// @vitest-environment node
// What the server is allowed to end on its own (#1467).
//
// The rule this replaces asked "is it resumable" — live ∨ grid log ∨ transcript ∨ rollout — of
// which two limbs are permanent records: a transcript is never deleted and the grid log is
// append-only. So on the machine this was measured on, a sweep would have ended 2 of 22 sessions
// while 15 sat idle for hours with nobody attached. Everything below is about NOW instead.
import { describe, it, expect, vi } from "vitest";

import {
  reapIdleSessions,
  reapSweepLines,
  startIdleSessionSweep,
  survivingAfterSweep,
  sweepTimerLine,
  type ReapSweepInput,
  type ReapSweepResult,
  type SweepTimerDeps,
} from "../../../server/session/reap-idle-sessions.js";
import { reapableTmuxSession, isRestorableSession } from "../../../server/infra/tmux.js";
import { DEFAULT_REAP_IDLE_DAYS, reapIdleSeconds } from "../../../common/sessionReap.js";

const NOW = 2_000_000;
const DAY = 24 * 60 * 60;
const STALE = NOW - 30 * DAY;

const input = (over: Partial<ReapSweepInput> = {}): ReapSweepInput => ({
  ids: [],
  activity: new Map(),
  attached: new Map(),
  nowSeconds: NOW,
  idleDays: DEFAULT_REAP_IDLE_DAYS,
  liveHere: () => false,
  // True by default so the readable ids these tests use ("stale", "held") keep meaning what they
  // say; the live sweep answers with SESSION_ID_RE, and the unparseable-id test overrides this.
  validId: () => true,
  kill: vi.fn((id: string) => Boolean(id)),
  ...over,
});

describe("reapableTmuxSession", () => {
  const facts = (over: Partial<Parameters<typeof reapableTmuxSession>[0]> = {}) => ({
    attachedCount: 0,
    liveHere: false,
    idleSeconds: 30 * DAY,
    idleThresholdSeconds: reapIdleSeconds(DEFAULT_REAP_IDLE_DAYS),
    validId: true,
    ...over,
  });

  it("ends a session nobody is attached to that has been silent past the threshold", () => {
    expect(reapableTmuxSession(facts())).toBe(true);
  });

  it("spares one a terminal is holding", () => {
    expect(reapableTmuxSession(facts({ attachedCount: 1 }))).toBe(false);
  });

  // #747: another mulmoterminal may hold it, and a count tmux would not give us is not evidence
  // that nobody does. Killing on that guess is worse than the pile-up.
  it("spares one whose attach count tmux would not give", () => {
    expect(reapableTmuxSession(facts({ attachedCount: null }))).toBe(false);
  });

  it("spares one this process has a pty for, however long tmux thinks it has been quiet", () => {
    expect(reapableTmuxSession(facts({ liveHere: true, idleSeconds: 365 * DAY }))).toBe(false);
  });

  it("spares one whose age is unknown", () => {
    expect(reapableTmuxSession(facts({ idleSeconds: null }))).toBe(false);
  });

  it("spares one that was active within the threshold", () => {
    expect(reapableTmuxSession(facts({ idleSeconds: 6 * DAY }))).toBe(false);
  });

  // Zero is the off switch, and it has to hold even for a session idle for a year.
  it("ends nothing at all when the threshold is zero", () => {
    expect(reapableTmuxSession(facts({ idleThresholdSeconds: 0, idleSeconds: 365 * DAY }))).toBe(false);
  });

  // A live `mt-undefined` was found (#1533): an id that does not parse is unreachable by EVERY
  // route — nothing can attach, resume or terminate it — so this sweep is the only thing that can
  // ever end it, and no amount of recency can make it reachable.
  it("ends one whose id no route can reach, however recently it was active", () => {
    expect(reapableTmuxSession(facts({ validId: false, idleSeconds: 0 }))).toBe(true);
  });

  // Someone can still be LOOKING at it — `tmux attach` by hand is how such a session gets
  // inspected at all — and killing a pane out from under them is not cleanup.
  it("spares even an unreachable one while a terminal is attached", () => {
    expect(reapableTmuxSession(facts({ validId: false, attachedCount: 1 }))).toBe(false);
  });

  it("the zero threshold switches off even the unreachable-id reap", () => {
    expect(reapableTmuxSession(facts({ validId: false, idleThresholdSeconds: 0 }))).toBe(false);
  });
});

// The column #1479 got wrong: `live ∨ grid` was counted as restorable, so 20 of 22 rows claimed a
// conversation could be brought back when 15 could.
describe("isRestorableSession", () => {
  const none = new Set<string>();

  it("is restorable with a claude transcript on disk", () => {
    expect(isRestorableSession("s-1", new Set(["s-1"]), () => false)).toBe(true);
  });

  it("is restorable with a codex rollout", () => {
    expect(isRestorableSession("s-1", none, (id) => id === "s-1")).toBe(true);
  });

  it("is NOT restorable just because it once was a grid cell or is running now", () => {
    expect(isRestorableSession("shell-1", none, () => false)).toBe(false);
  });
});

describe("the boot sweep", () => {
  it("ends the stale ones and counts what it kept, and why", () => {
    const kill = vi.fn((id: string) => Boolean(id));
    const result = reapIdleSessions(
      input({
        ids: ["stale", "held", "fresh", "ours"],
        activity: new Map([
          ["stale", STALE],
          ["held", STALE],
          ["fresh", NOW - DAY],
          ["ours", STALE],
        ]),
        attached: new Map([["held", 1]]),
        liveHere: (id) => id === "ours",
        kill,
      }),
    );
    expect(kill.mock.calls.map((c) => c[0])).toEqual(["stale"]);
    expect(result).toEqual({ reaped: ["stale"], heldBack: 2, recent: 1, unclear: 0 });
  });

  // `list-clients` reports only sessions that HAVE a client, so absent means zero — but a null map
  // (tmux itself could not answer) must not read the same way. And it is not "in use" either: the
  // reason it was kept is that nobody could say (CodeRabbit on #1486).
  it("keeps a session whose attach count tmux would not give, as its own reason", () => {
    const kill = vi.fn((id: string) => Boolean(id));
    const result = reapIdleSessions(input({ ids: ["stale"], activity: new Map([["stale", STALE]]), attached: null, kill }));
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ reaped: [], heldBack: 0, recent: 0, unclear: 1 });
  });

  it("keeps a session of unknown age without calling it active", () => {
    const kill = vi.fn((id: string) => Boolean(id));
    const result = reapIdleSessions(input({ ids: ["ageless"], activity: new Map(), kill }));
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ reaped: [], heldBack: 0, recent: 0, unclear: 1 });
  });

  // `tmux kill-session` can refuse. Recording it as ended anyway would have boot delete the settings
  // file of a session that is still running — and that file can hold a provider's API token.
  it("does not record a kill tmux refused", () => {
    const kill = vi.fn((id: string) => id !== "stale");
    const result = reapIdleSessions(input({ ids: ["stale"], activity: new Map([["stale", STALE]]), kill }));
    expect(kill).toHaveBeenCalledWith("stale");
    expect(result).toEqual({ reaped: [], heldBack: 0, recent: 0, unclear: 1 });
  });

  it("does nothing whatsoever when the threshold is zero", () => {
    const kill = vi.fn((id: string) => Boolean(id));
    const result = reapIdleSessions(input({ ids: ["stale"], activity: new Map([["stale", STALE]]), idleDays: 0, kill }));
    expect(kill).not.toHaveBeenCalled();
    expect(result).toEqual({ reaped: [], heldBack: 0, recent: 0, unclear: 0 });
  });

  // The `mt-undefined` case (#1533): recently active, nobody attached — and still ended, because
  // its id parses as nothing any route will serve, so waiting out the idle grace serves no one.
  it("reaps an unparseable id at once, ignoring the idle grace", () => {
    const kill = vi.fn((id: string) => Boolean(id));
    const result = reapIdleSessions(
      input({
        ids: ["undefined", "fresh"],
        activity: new Map([
          ["undefined", NOW - DAY],
          ["fresh", NOW - DAY],
        ]),
        validId: (id) => id !== "undefined",
        kill,
      }),
    );
    expect(kill.mock.calls.map((c) => c[0])).toEqual(["undefined"]);
    expect(result).toEqual({ reaped: ["undefined"], heldBack: 0, recent: 1, unclear: 0 });
  });
});

// A sweep that prints only what it killed leaves the reader unable to tell "nothing was old enough"
// from "it never ran" — which is the state #1467 was filed about.
describe("what the sweep says", () => {
  it("reports both what it ended and what it kept", () => {
    const lines = reapSweepLines({ reaped: ["a", "b"], heldBack: 6, recent: 12, unclear: 0 }, 7).join("\n");
    expect(lines).toContain("ended 2 idle session(s)");
    expect(lines).toContain("kept 18: 6 in use, 12 active within 7 day(s)");
  });

  // Never as "in use" or "active": those are facts, and this one is a question tmux declined.
  it("names the ones tmux would not report on separately", () => {
    const lines = reapSweepLines({ reaped: [], heldBack: 1, recent: 1, unclear: 2 }, 7).join("\n");
    expect(lines).toContain("kept 4: 1 in use, 1 active within 7 day(s), 2 tmux would not report on");
  });

  it("leaves that clause out when there is nothing unclear", () => {
    expect(reapSweepLines({ reaped: [], heldBack: 1, recent: 1, unclear: 0 }, 7).join("\n")).not.toContain("would not report");
  });

  it("still says what it kept when it ended nothing", () => {
    expect(reapSweepLines({ reaped: [], heldBack: 1, recent: 2, unclear: 0 }, 7).join("\n")).toContain("kept 3");
  });

  it("says it is off rather than silently doing nothing", () => {
    expect(reapSweepLines({ reaped: [], heldBack: 0, recent: 0, unclear: 0 }, 0).join("\n")).toContain("off");
  });

  it("says nothing at all when there were no sessions to judge", () => {
    expect(reapSweepLines({ reaped: [], heldBack: 0, recent: 0, unclear: 0 }, 7)).toEqual([]);
  });
});

// Boot reads the tmux list, sweeps, and THEN decides which settings and drop files are orphaned —
// from that same list. A file kept because its session was in it outlives the session by a whole
// boot, and a session settings file can hold a provider's API token (the reason the prune exists).
// Found reading the boot path during review; no bot flagged it.
describe("survivingAfterSweep", () => {
  it("drops what the sweep just ended", () => {
    expect([...survivingAfterSweep(["kept", "ended", "also-kept"], ["ended"])]).toEqual(["kept", "also-kept"]);
  });

  it("is the whole list when the sweep ended nothing", () => {
    expect([...survivingAfterSweep(["a", "b"], [])]).toEqual(["a", "b"]);
  });
});

// The timer that makes the sweep something other than a restart-only event (#2165). The rule for
// WHICH sessions go is pinned above; what is pinned here is that the tick runs at all, that it runs
// against the CURRENT threshold, and that what it ends does not leave its files behind.
describe("startIdleSessionSweep", () => {
  const swept = (over: Partial<ReapSweepResult> = {}): ReapSweepResult => ({ reaped: [], heldBack: 0, recent: 0, unclear: 0, ...over });

  const timer = (over: Partial<SweepTimerDeps> = {}) => {
    const ticks: (() => void)[] = [];
    const armed: number[] = [];
    const logged: string[] = [];
    const cleaned: string[] = [];
    const deps: SweepTimerDeps = {
      intervalHours: 6,
      idleDays: () => DEFAULT_REAP_IDLE_DAYS,
      sweep: () => swept(),
      cleanupSession: (id) => void cleaned.push(id),
      validId: () => true,
      log: (line) => void logged.push(line),
      every: (intervalMs, tick) => {
        armed.push(intervalMs);
        ticks.push(tick);
      },
      ...over,
    };
    return { deps, ticks, armed, logged, cleaned, started: startIdleSessionSweep(deps) };
  };

  it("arms a timer at the configured cadence", () => {
    const t = timer({ intervalHours: 2 });
    expect(t.started).toBe(true);
    expect(t.armed).toEqual([2 * 60 * 60 * 1000]);
  });

  // Zero is how a user gets the original behaviour back, so it must arm NOTHING rather than arm a
  // timer that fires immediately and forever.
  it("arms nothing when the cadence is off", () => {
    const t = timer({ intervalHours: 0 });
    expect(t.started).toBe(false);
    expect(t.armed).toEqual([]);
  });

  // Read per tick, not captured: the Settings stepper writes this number while the server runs, and
  // a timer holding the boot value would act on a threshold the list beside it has stopped showing.
  it("asks for the idle threshold on every tick", () => {
    const days = vi.fn(() => 3);
    const sweep = vi.fn(() => swept());
    const t = timer({ idleDays: days, sweep });
    t.ticks[0]();
    t.ticks[0]();
    expect(days).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenNthCalledWith(1, 3);
    days.mockReturnValue(9);
    t.ticks[0]();
    expect(sweep).toHaveBeenNthCalledWith(3, 9);
  });

  // A session settings file can hold a provider's API token. Until this timer existed the only
  // thing that removed one was the next boot's orphan prune, which on a server up for days never
  // comes — so the tick drops what it just ended.
  it("drops the files of each session it ended", () => {
    const t = timer({ sweep: () => swept({ reaped: ["mt-a", "mt-b"] }) });
    t.ticks[0]();
    expect(t.cleaned).toEqual(["mt-a", "mt-b"]);
  });

  // The sweep ends an unparseable id on purpose — it is unreachable by every route and can only
  // leak (#1533) — and the cleanup builds a FILE PATH out of what it is handed. So the check the
  // boot prunes already make before deleting is made here too.
  it("does not build a path out of an id that is not a session id", () => {
    const t = timer({ sweep: () => swept({ reaped: ["mt-undefined", "good"] }), validId: (id) => id === "good" });
    t.ticks[0]();
    expect(t.cleaned).toEqual(["good"]);
  });

  it("cleans up nothing when the sweep ended nothing", () => {
    const t = timer({ sweep: () => swept({ heldBack: 3, recent: 5 }) });
    t.ticks[0]();
    expect(t.cleaned).toEqual([]);
  });

  it("reports what it ended", () => {
    const t = timer({ sweep: () => swept({ reaped: ["mt-a"], recent: 2 }) });
    t.ticks[0]();
    expect(t.logged.join("\n")).toContain("ended 1 idle session");
  });

  // Silent otherwise. Boot prints both lines because a reader there is asking "did it run at all";
  // a tick that said "kept 22" every few hours would answer that forever and bury the one line
  // that reports an action.
  it("says nothing on a tick that ended nothing", () => {
    const t = timer({ sweep: () => swept({ heldBack: 4, recent: 9, unclear: 1 }) });
    t.ticks[0]();
    expect(t.logged).toEqual([]);
  });
});

// A timer that has never fired is indistinguishable in the log from one that was never armed —
// which is the confusion #1467 was filed about, one level up.
describe("sweepTimerLine", () => {
  it("says the cadence when a timer is armed", () => {
    expect(sweepTimerLine(6)).toContain("every 6 hour(s)");
  });

  it("says so when the sweep only runs at start", () => {
    expect(sweepTimerLine(0)).toContain("at start only");
  });
});
