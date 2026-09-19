# feat: sweep idle sessions on a timer, not only at boot (#2165)

## The report

A long-running server held a pile of tmux sessions, most of them detached, last active
more than a day earlier, all of them idle `zsh`. `sessionIdleReapDays` was at its default.

## Why nothing cleaned them

`sweepIdleSessions` has exactly one caller that runs by itself — `server/index.ts`, at
boot. `POST /api/tmux/cleanup-orphans` is the only other, and something has to ask. So a
restart is the sole occasion on which a session is ever ended unasked, and a server that
does not restart never ends one.

The threshold is not the problem. Those sessions were still inside it; what a timer
changes is that they are reaped when they cross it rather than at whatever restart
happens to come next.

## The change

A `sessionReapIntervalHours` config key, and a timer that runs the existing sweep on it.

- **Default 6 hours, on.** The predicate does not move, so the only thing that changes
  for an existing user is WHEN a session already destined for the sweep is ended. `0`
  turns the timer off and restores boot-only behaviour.
- **The threshold stays `sessionIdleReapDays`.** Every session `reapableTmuxSession`
  accepts is already detached — it requires `attachedCount === 0` — so a "detached-only"
  threshold would be a second name for the one that exists.
- **`liveHere` keeps its veto.** A pty of ours means a cell is open on it, and no amount
  of idle time makes ending that right. The sweep was written to be safe whenever it
  runs, which is what makes a timer a caller it can have.

## Shape

- `common/sessionReap.ts` gains the bounds and the sanitizer, beside the day ones and for
  the same reason: the Settings stepper offers the range the server clamps to.
- `server/session/reap-idle-sessions.ts` gains `startIdleSessionSweep`, which arms the
  timer and returns whether it did. `setInterval(...).unref()`, as the update check does,
  so it never holds the process open.
- The interval is read at boot; the idle days are read at each tick. That asymmetry is
  the existing convention (`getWorklogConfig`, `getSystemTaskSwitches`): a scheduled thing
  registers once, and the number it acts against is read live so the stepper beside the
  list takes effect without a restart.
- Settings: a second stepper in `SurvivingSessionsSection`, which already owns the days. The
  "ends at next start" mark follows the cadence — with a timer armed it is the one thing a row
  says that a running server makes false.
- `server/index.ts` was at its `max-lines` budget exactly, so the tmux boot block moves to
  `server/session/session-upkeep.ts` — the extraction `scheduler-boot.ts` made for the same
  reason, and for its reason: the WHY of those calls is far longer than the calls, and none of it
  is boot ORDER. It answers with the surviving set the orphan prunes already decided from.

## Verification

- Specs for the sanitizer, for the timer's arm/skip decision, for the tick reading the days live,
  and for the tick dropping what it ended.
- The sweep predicate itself is untouched, so its existing specs are the regression net.
- The boot path is the wide blast radius here, so it is run rather than reasoned about: a server
  started against a scratch home prints the new line in both states, serves the UI, and leaves
  every live tmux session alone (the scratch config has the sweep off, so nothing of the user's
  can be ended by the check itself).
- `unref` is the one thing a spec with an injected timer cannot see, so the production
  `startIdleSessionSweepTimer` is armed in a throwaway harness and the process is watched to exit
  rather than wait out the interval.
