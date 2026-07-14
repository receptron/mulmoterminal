# feat: Web Push fires on every finished turn (drop the active-pane exemption)

## Problem

Web Push only fired for a finished turn on a session the user was NOT actively viewing
(`event === "Stop" && !active`) — the same suppression the attention beep uses. So the
session the user is driving in the single view (or the zoomed grid cell) never pushed,
because it is always `active` (see `terminalViewActive`: single view is active whenever
shown; a grid cell is active while zoomed). `active` is pane-selection based, not window
focus based, so even backgrounding the browser did not fire it.

Diagnosed live via temporary hook instrumentation: a real Stop for the viewed session
logged `active=true` → suppressed; an eligible background Stop logged `active=false` and
reached the sender. (The dominant real-world cause of "no push" was a *separate* issue —
the server-side RemoteHost session dropping on restart while the browser UI still showed
"connected" — tracked separately.)

## Decision

Per the user: **notify on every finished turn, regardless of active.** The attention beep
keeps its active-pane suppression (you are looking at it); only the phone push ignores it.

## Change

- `server/activity-hook.ts`: add pure `shouldNotifyTaskFinished(event) => event === "Stop"`
  (deliberately takes no `active` — documents/locks in that the push is not pane-gated).
- `server/index.ts` `handleActivityHook`: replace `event === "Stop" && !active` with
  `shouldNotifyTaskFinished(event)`. `notifyTaskFinished` keeps its pushEnabled / hidden /
  translation-worker gates and its single-fire-per-turn guarantee.
- `server/activity-hook.spec.ts`: cover the new predicate (Stop → true; non-Stop → false).

## Trade-off (accepted by the user)

Every finished turn of every non-hidden session now pushes — including the session being
watched. With multiple registered devices, each push lands on all of them. If this proves
noisy, a follow-up could gate on window focus/visibility ("notify only when you're away")
instead of pane selection, or add a per-session opt-out.

## Acceptance

- A Stop on the actively-viewed session now sends a push (was suppressed).
- The attention beep is unchanged (`activityHookEffects` untouched).
- Gates green (format / lint / typecheck / typecheck:server / build / test).
