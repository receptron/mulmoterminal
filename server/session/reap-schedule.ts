// WHEN the idle sweep runs: once at boot, and — when asked for — again on a timer (#2165).
//
// The boot sweep is the strong one. At startup none of OUR ptys hold anything, so nothing is held
// back by `liveHere` and the pile is at its largest. The timer is necessarily WEAKER — a session
// this server holds a pty for is skipped whatever its age — and does not replace it. What it
// reaches is the class that accumulates during a long run: the pty let go, no terminal attached,
// nothing written for `idleDays` days. A server left up for weeks otherwise never looks again.
import { REAP_INTERVAL_HOURS_OFF, reapIntervalMs, reapTimerEnabled } from "../../common/sessionReap.js";
import { reapSweepLines, sweepIdleSessions } from "./reap-idle-sessions.js";
import { cleanupSessionSettings } from "./session-settings.js";
import { cleanupSessionDrops } from "./session-drops.js";
import { SESSION_ID_RE } from "../config/env.js";

export interface ReapSchedule {
  intervalHours: number;
  /** Read at each sweep rather than captured: the threshold is live config and may have changed. */
  idleDays: () => number;
  log: (line: string) => void;
}

const sweepNow = (idleDays: () => number, log: (line: string) => void) => {
  const days = idleDays();
  const sweep = sweepIdleSessions(Date.now(), days);
  reapSweepLines(sweep, days).forEach(log);
  return sweep;
};

/**
 * Drop what a session the TIMER ended left on disk.
 *
 * The boot sweep does not need this — infra/on-listening.ts prunes orphans straight after it, against
 * the live-peer cutoff that only a boot can work out (#1061). A tick has no such follower, so
 * without this the files outlive the session until the next restart, and the whole reason to
 * enable a timer is that the next restart is far away.
 *
 * What is being left behind is not inert: session-settings.ts keeps a provider session's API
 * token in its file, which is why #1467 removes these at all.
 *
 * The id is checked before it becomes a path. The sweep ends ids that are NOT session ids on
 * purpose — an unparseable one is unreachable by every route and can only leak (#1533) — and
 * `settingsFile()` joins the id straight onto the settings directory. The boot prunes already
 * make this check; a second route to the same files needs it too.
 */
const dropEndedSessionFiles = (reaped: readonly string[]): void => {
  reaped
    .filter((id) => SESSION_ID_RE.test(id))
    .forEach((id) => {
      cleanupSessionSettings(id);
      cleanupSessionDrops(id);
    });
};

/** The interval a previous schedule started, so a new one can cancel it. */
let armedTimer: ReturnType<typeof setInterval> | null = null;

// Off unless asked for: a running server that starts ending sessions because someone upgraded is
// the surprise worth avoiding.
//
// Answers with what it armed — the hours, or OFF when it armed nothing — and that return value is
// the whole of what `armedReapIntervalHours` reports.
//
// **A superseded schedule is cancelled first, on every call, including one that arms nothing.**
// Without that, `startReapSchedule(6)` then `startReapSchedule(0)` leaves the six-hour interval
// ticking while the getter says OFF, and the list then promises "ends at next start" about a
// session the very next sweep will take — the understatement this whole change exists to remove
// (Codex round 1 on #2191, reproduced by advancing the clock and watching a sweep fire).
//
// This is NOT the live re-arming that #2167 declined. That was re-arming on every config POST,
// which lets a stream of edits reset the countdown forever. This cancels only when a caller
// explicitly starts a new schedule, which happens once per process at boot.
function armTimer({ intervalHours, idleDays, log }: ReapSchedule): number {
  if (armedTimer !== null) {
    clearInterval(armedTimer);
    armedTimer = null;
  }
  if (!reapTimerEnabled(intervalHours)) return REAP_INTERVAL_HOURS_OFF;
  log(`[tmux] idle-session sweep repeats every ${intervalHours}h`);
  const timer = setInterval(() => {
    dropEndedSessionFiles(sweepNow(idleDays, log).reaped);
  }, reapIntervalMs(intervalHours));
  timer.unref(); // a sweep waiting to run is never a reason to keep the process alive
  armedTimer = timer;
  return intervalHours;
}

/**
 * The cadence THIS process is actually running, which is not the same thing as the cadence in the
 * config (#2184).
 *
 * The timer is armed once, at boot, and `config-routes.ts` says why it is not re-armed on a POST:
 * a stream of edits would reset the countdown forever. So from the moment someone saves a new
 * interval until the next restart, the saved number describes a future server and this one
 * describes the running one — and the Settings list needs the running one, because a row that
 * promises "ends on the next sweep" when no sweep is scheduled is a fresh lie told to exactly the
 * person who just switched the feature on.
 *
 * Zero means nothing is scheduled: either the interval is off, or tmux was missing at boot and the
 * schedule never started at all.
 */
let armedIntervalHours = REAP_INTERVAL_HOURS_OFF;
export const armedReapIntervalHours = (): number => armedIntervalHours;

/** Sweeps once, arms the repeat, and answers with what the boot sweep ended. */
export function startReapSchedule(schedule: ReapSchedule): string[] {
  const sweep = sweepNow(schedule.idleDays, schedule.log);
  // Assigned on EVERY call, not only when a timer starts: were it set inside the `if`, a schedule
  // that armed nothing would leave the previous value standing and report a cadence that is not
  // running. `armTimer` cancels any superseded interval first, so the number it returns is the
  // timer that is actually scheduled rather than merely the last one started.
  armedIntervalHours = armTimer(schedule);
  return sweep.reaped;
}
