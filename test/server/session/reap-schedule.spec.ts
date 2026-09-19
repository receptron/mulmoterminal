// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sweepIdleSessions = vi.fn(() => ({ reaped: ["mt-gone"], heldBack: 0, recent: 0, unclear: 0 }));
const reapSweepLines = vi.fn(() => ["[tmux] swept"]);
const cleanupSessionSettings = vi.fn();
const cleanupSessionDrops = vi.fn();

vi.mock("../../../server/session/reap-idle-sessions.js", () => ({
  sweepIdleSessions: (...a: unknown[]) => sweepIdleSessions(...(a as [])),
  reapSweepLines: (...a: unknown[]) => reapSweepLines(...(a as [])),
}));

// Mocked because the real ones DELETE: a spec that let them run would be removing whatever files
// happen to sit under the developer's own ~/.mulmoterminal.
vi.mock("../../../server/session/session-settings.js", () => ({
  cleanupSessionSettings: (...a: unknown[]) => cleanupSessionSettings(...(a as [])),
}));
vi.mock("../../../server/session/session-drops.js", () => ({
  cleanupSessionDrops: (...a: unknown[]) => cleanupSessionDrops(...(a as [])),
}));

const { startReapSchedule, armedReapIntervalHours } = await import("../../../server/session/reap-schedule.js");

// Real session ids are UUIDs (SESSION_ID_RE in server/config/env.ts), and the guard under test
// rejects anything else — so a readable stand-in like "mt-a" would make these pass for the wrong
// reason. `tmuxListSessionIds` strips the `mt-` prefix, so what reaches the sweep is the bare id:
// the unparseable one #1533 reported arrives here as "undefined".
const ID_A = "11111111-2222-3333-4444-555555555555";
const ID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("startReapSchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sweepIdleSessions.mockClear();
    reapSweepLines.mockClear();
    cleanupSessionSettings.mockClear();
    cleanupSessionDrops.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  const schedule = (intervalHours: number, log: (line: string) => void = () => {}) => ({ intervalHours, idleDays: () => 7, log });

  it("sweeps once at boot and answers with what it ended", () => {
    const reaped = startReapSchedule(schedule(0));
    expect(sweepIdleSessions).toHaveBeenCalledTimes(1);
    expect(reaped).toEqual(["mt-gone"]);
  });

  // Off is the default, so this is the behaviour an untouched config must keep.
  it("arms nothing when the interval is off", () => {
    startReapSchedule(schedule(0));
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(sweepIdleSessions).toHaveBeenCalledTimes(1); // the boot sweep, and no more
  });

  it("sweeps again on each interval once armed", () => {
    startReapSchedule(schedule(6));
    expect(sweepIdleSessions).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(sweepIdleSessions).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000);
    expect(sweepIdleSessions).toHaveBeenCalledTimes(3);
  });

  it("says on the log that the sweep will repeat", () => {
    const lines: string[] = [];
    startReapSchedule(schedule(6, (line) => lines.push(line)));
    expect(lines.some((l) => l.includes("repeats every 6h"))).toBe(true);
  });

  // A session settings file holds a provider's API token. The boot sweep is followed by the orphan
  // prune in infra/on-listening.ts; a tick has no follower, so without this the token outlives the
  // session until the next restart — and a timer is enabled precisely when that is far away.
  it("drops the files of every session a tick ended", () => {
    sweepIdleSessions.mockReturnValue({ reaped: [ID_A, ID_B], heldBack: 0, recent: 0, unclear: 0 });
    startReapSchedule(schedule(1));
    // The boot sweep's own reaped list is NOT cleaned here: on-listening.ts prunes after it, against a
    // live-peer cutoff this module cannot work out.
    expect(cleanupSessionSettings).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(cleanupSessionSettings.mock.calls.map(([id]) => id)).toEqual([ID_A, ID_B]);
    expect(cleanupSessionDrops.mock.calls.map(([id]) => id)).toEqual([ID_A, ID_B]);
  });

  // The sweep ends an id that is not a session id on purpose (#1533) — it is unreachable by every
  // route and can only leak. `settingsFile()` joins the id onto the settings directory, so this
  // route to the files makes the check the boot prunes already make.
  it("does not build a path out of an id that is not a session id", () => {
    sweepIdleSessions.mockReturnValue({ reaped: ["undefined", "../../etc/passwd", ID_A], heldBack: 0, recent: 0, unclear: 0 });
    startReapSchedule(schedule(1));
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(cleanupSessionSettings.mock.calls.map(([id]) => id)).toEqual([ID_A]);
    expect(cleanupSessionDrops.mock.calls.map(([id]) => id)).toEqual([ID_A]);
  });

  it("cleans up nothing on a tick that ended nothing", () => {
    sweepIdleSessions.mockReturnValue({ reaped: [], heldBack: 4, recent: 2, unclear: 0 });
    startReapSchedule(schedule(1));
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(cleanupSessionSettings).not.toHaveBeenCalled();
    expect(cleanupSessionDrops).not.toHaveBeenCalled();
  });

  // What the SETTINGS list needs, and what the saved config cannot tell it: the timer is armed
  // once at boot and not re-armed on a POST, so from a save until the next restart the saved
  // number describes a future server while this one describes the running one (#2184).
  it("reports the cadence it armed", () => {
    startReapSchedule(schedule(6));
    expect(armedReapIntervalHours()).toBe(6);
  });

  it("reports OFF when it armed nothing", () => {
    startReapSchedule(schedule(0));
    expect(armedReapIntervalHours()).toBe(0);
  });

  // The one that would rot silently. Were the value assigned only inside the `if` that starts a
  // timer, a later schedule that armed NOTHING would leave the earlier number standing, and the
  // list would promise a sweep that is not scheduled — the exact false claim #2184 exists to end.
  it("stops reporting a cadence once a later schedule arms none", () => {
    startReapSchedule(schedule(6));
    expect(armedReapIntervalHours()).toBe(6);
    startReapSchedule(schedule(0));
    expect(armedReapIntervalHours()).toBe(0);
  });

  // The threshold is live config: a POST between ticks must be what the next sweep uses.
  it("re-reads the idle threshold at every tick", () => {
    let days = 7;
    startReapSchedule({ intervalHours: 1, idleDays: () => days, log: () => {} });
    days = 2;
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(sweepIdleSessions).toHaveBeenLastCalledWith(expect.any(Number), 2);
  });
});

// Harvested from the throwaway differential that proved the boot block's move (#2165): the old
// inline version in server/index.ts is gone, so what survives is the GENERATOR (which sweep
// shapes, thresholds and log outputs matter) and the PROPERTY the old block had — the boot half
// returns the sweep's reaped list verbatim, logs exactly what reapSweepLines produced, and asks
// the sweep with the threshold read at that moment.
const SWEEP_SHAPES = [
  { reaped: [], heldBack: 0, recent: 0, unclear: 0 },
  { reaped: ["mt-a"], heldBack: 0, recent: 0, unclear: 0 },
  { reaped: ["mt-a", "mt-b", "mt-c"], heldBack: 2, recent: 5, unclear: 1 },
  { reaped: [], heldBack: 9, recent: 0, unclear: 3 },
];
const THRESHOLDS = [0, 1, 7, 30, 365];
const LOG_OUTPUTS = [[], ["[tmux] one"], ["[tmux] one", "[tmux] two"]];
/** The generator, flattened: the cross product is the input set, one case per row. */
const BOOT_CASES = SWEEP_SHAPES.flatMap((shape) => THRESHOLDS.flatMap((days) => LOG_OUTPUTS.map((lines) => ({ shape, days, lines }))));

describe("startReapSchedule — the boot half, over every shape a sweep can answer with", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sweepIdleSessions.mockReset();
    reapSweepLines.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("returns the reaped list, logs the sweep lines, and passes the live threshold", () => {
    BOOT_CASES.forEach(({ shape, days, lines }) => {
      sweepIdleSessions.mockReturnValue(shape);
      reapSweepLines.mockReturnValue(lines);
      const logged: string[] = [];
      const reaped = startReapSchedule({ intervalHours: 0, idleDays: () => days, log: (l) => logged.push(l) });

      expect(reaped).toEqual(shape.reaped);
      expect(logged).toEqual(lines);
      expect(sweepIdleSessions).toHaveBeenLastCalledWith(expect.any(Number), days);
      expect(reapSweepLines).toHaveBeenLastCalledWith(shape, days);

      sweepIdleSessions.mockReset();
      reapSweepLines.mockReset();
    });
    expect(BOOT_CASES).toHaveLength(SWEEP_SHAPES.length * THRESHOLDS.length * LOG_OUTPUTS.length);
  });
});
