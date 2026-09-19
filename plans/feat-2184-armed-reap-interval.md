# feat: the hint states the cadence the server ARMED, not the one in the config (#2184)

## The gap

#2183 gave `sessionReapIntervalHours` a control and deliberately refused to let the row's
wording follow it. The reason was sound: `startReapSchedule` arms the timer **once, at
boot**, and `config-routes.ts` says why it is not re-armed on a POST — a stream of edits
would reset the countdown forever. So between a save and the next restart, the saved number
describes a future server.

That left the row **understating**. On a server that booted with a repeat armed, a doomed
session goes at the next sweep, and the row still points at a restart that is not the next
thing to happen.

The half that was missing is not a UI decision. **Nothing recorded what was armed**, so the
browser had no true number to render.

## The change

`armTimer` returns the cadence it started — the hours, or OFF when it started nothing — and
`startReapSchedule` records it. `armedReapIntervalHours()` reads it back.

That value rides on the `/api/tmux/sessions` response, which this Settings section already
fetches, rather than a route of its own: the list is what needs it, because a row's promise
depends on whether a sweep is scheduled.

## What #2189 changed about this, mid-review

While this was in review, **#2189 merged** and fixed the same falsehood a different way: the row
stopped naming a clock at all. It reads **due to be ended**, its title says *the next sweep ends
it*, and a standing note says the cadence is read at server start. All true whatever is armed.

That is the better base, and this change now sits on top of it rather than replacing it:

- **the row is #2189's, unchanged.** It names the EVENT. Knowing the armed cadence does not make
  a clock on the row any more useful, and #2189's own comment says so.
- **what the armed value buys is the HINT.** #2189 had to write *"Saved: repeats every N"* because
  the browser was never told what was running. With it on the wire the hint can stop hedging:
  saved-and-armed-agree states the running cadence as a fact, and a disagreement says the value is
  saved and names what is still sweeping until the restart.
- **when the server does not report it**, the hint falls back to the saved-value wording rather
  than inventing a present-tense claim.

## Decisions

- **Assigned on every call, not only when a timer starts.** Inside the `if`, a later schedule
  that armed nothing would leave the previous number standing and report a cadence that is not
  running — the exact false claim this issue exists to end.
- **A superseded schedule is CANCELLED, on every call, including one that arms nothing.** The
  first version of this change only reassigned the number, and that was not enough: a
  `startReapSchedule(6)` followed by `startReapSchedule(0)` left the six-hour interval ticking
  while the getter said OFF, so the list promised "ends at next start" about a session the very
  next sweep would take. That is the understatement this issue exists to remove, re-created in a
  new place. Found by Codex in round 1 of #2191's review and reproduced by advancing the clock.
- **`armTimer` returns what it armed**, and cancels before it arms, so the number reported is the
  timer that is actually scheduled — not merely the last one someone started.
- **Cancelling is not the live re-arming #2167 declined.** That was re-arming on every config
  POST, which lets a stream of edits reset the countdown forever. This cancels only when a caller
  explicitly starts a new schedule, which production does once, at boot.
- **Read per request, not captured at mount.** Routes are mounted before the server listens,
  and the schedule does not arm until it does; a captured value would be OFF forever.
- **The client falls back to OFF**, not to the saved value, when the server does not say — an
  older server, or an unreadable body. Understating is the only safe direction for a claim
  about when someone's session disappears.
- **Not live re-arming.** That would make saved and armed agree with no new wire field, and it
  was declined on #2184 for the reason #2167 documented: re-arming on every POST lets a stream
  of edits reset the countdown forever, and it would reverse a contract deliberately set.

## Verification

- Specs at each layer: the schedule reports what it armed, stops reporting one when a later
  schedule arms none, **and stops the superseded sweep itself — asserted by advancing the clock
  and counting sweeps, because asserting only the number is what let the defect through**; the
  route puts it on the response and asks per request; the component decides the row from it,
  ignores the saved value, shows the pending state, and falls back to OFF when the field is
  absent.
- Five mutations, each red, each with its application asserted by count before running —
  including the specific regression of keying the row off the saved cadence again.
- i18n lockstep across **five** locales: `en`, `ja`, `ko`, `zh-CN`, `zh-TW`. The last three
  arrived in #2180 while this was being written; `vue-tsc` is what caught their absence.
