// What boot does about the tmux sessions that outlived the last server (#1467, #2165).
//
// Its own module for scheduler-boot.ts's reason: the WHY of each of these calls is far longer than
// the calls, and none of it is boot ORDER — which is what a reader of server/index.ts is there for.
import { tmuxAvailable, tmuxListSessionIds } from "../infra/tmux.js";
import { getSessionIdleReapDays, getSessionReapIntervalHours } from "../config/config-routes.js";
import { reapSweepLines, startIdleSessionSweepTimer, survivingAfterSweep, sweepIdleSessions, sweepTimerLine } from "./reap-idle-sessions.js";

/**
 * Say what survived, end what nothing is using, and arm the timer that keeps ending it.
 *
 * Answers with the sessions still standing, because that set is what the orphan prunes decide
 * from: a settings file kept because its session was in the list read a moment ago outlives the
 * session by a whole boot, and one of those files can hold a provider's API token (#1467).
 *
 * The sweep runs here because a restart is when none of OUR ptys hold anything, so "in use" means
 * somebody else's, and it is the moment the pile is largest. `cleanup-orphans` had existed since
 * #367 with no caller — this is that caller, with a rule that is about now instead of about the
 * past. It runs again on a timer because a restart being its ONLY occasion is what let a
 * long-running server collect the detached sessions the sweep exists to clear (#2165).
 */
export function startTmuxSessionUpkeep(): Set<string> {
  if (!tmuxAvailable()) {
    console.log("[tmux] not found — terminals are not persistent across a server restart");
    return new Set();
  }
  const surviving = tmuxListSessionIds();
  const detail = surviving.length ? ` — ${surviving.length} session(s) survived; reattach on connect` : "";
  console.log(`[tmux] persistence on${detail}`);
  const idleDays = getSessionIdleReapDays();
  const sweep = sweepIdleSessions(Date.now(), idleDays);
  reapSweepLines(sweep, idleDays).forEach((line) => console.log(line));
  // The threshold is re-read at each tick, so the Settings stepper lands without a restart; the
  // cadence is read once, here, because the timer is armed once (config/config-routes.ts).
  const intervalHours = getSessionReapIntervalHours();
  startIdleSessionSweepTimer(intervalHours, getSessionIdleReapDays);
  console.log(sweepTimerLine(intervalHours));
  return survivingAfterSweep(surviving, sweep.reaped);
}
