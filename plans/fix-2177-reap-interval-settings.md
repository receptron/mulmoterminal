# fix(#2177): the sweep interval reaches Settings, and the row stops promising "next start"

## What was wrong

#2167 added `sessionReapIntervalHours`, so the idle sweep runs on a timer as well as at boot.
The server took the whole change; the client took none of it.

**1. The number exists only for people who open `config.json`.** The threshold (days) has a
stepper beside the list it acts on — Settings → *Sessions that survived a restart* — and the
interval has nothing. `settings-coverage.spec.ts` records this: `sessionIdleReapDays` carries
`ui: true` and `sessionReapIntervalHours` does not. The default is `0` (off), so a feature that
must be turned on is reachable only by hand-editing a file.

**2. With the timer on, the row lies.** Three strings say the session ends at the next server
START — the `doomed` badge, its tooltip, and the hint under the stepper. Once the interval is
non-zero the session ends at the next SWEEP, which does not wait for a restart.

Neither is cosmetic: both mislead exactly the person who turned the feature on.

## Why the new wording is true, which was the part worth checking

The badge already answers the same question the sweep does. `surviving-sessions.ts` computes
`reapable` with `reapableTmuxSession({ liveHere: ptys.has(key), … })`, and
`reap-idle-sessions.ts` calls that same predicate with the same `ptys` registry. So the timer
sweep being *weaker* than the boot sweep — it cannot touch a session this process holds a pty
for — does not make "ends on the next sweep" a lie on a row that shows the badge: a row holding
a live pty here never shows it in the first place.

Had the badge been computed any other way, the honest wording would have been conditional
("unless this server is holding it"), so this is the fact the change rests on.

## What changed

- `src/composables/sessionReap.ts` gains the interval's ref / setter / saver beside the
  threshold's, following `worklog.ts` — the switch and the cadence of one feature live in one
  module there for the same reason.
- `src/composables/useAppConfig.ts` hydrates it. The server already sends the field; nothing
  read it.
- `SurvivingSessionsSection.vue` gains a second stepper, disabled while the threshold is `0`
  because an interval on a sweep that never runs decides nothing. Disabling is both the
  `pointer-events-none` container and the stepper's own `:disabled` — the latter is what stops a
  keyboard user tabbing into a control the screen calls unavailable.
- The three "next start" strings gain a timer variant each, chosen by `reapTimerEnabled`.
- `settings-coverage.spec.ts` records the key as having UI.

Nothing server-side changed. `app-config.ts` and `config-routes.ts` already carried the field
end to end.

## Deliberately not done

The default stays `0`. #2167 decided that a running server should not start ending sessions
because someone upgraded, and a Settings control does not change the argument.

## Verification

- The row's two wordings are pinned in both directions in the component spec: with the timer off
  the badge says next start, with it on it says next sweep. Written to fail against the old
  single-string version.
- The interval stepper's write path is pinned the way the threshold's already was — the POST
  names `sessionReapIntervalHours` — plus the disabled case, where a nudge must write nothing.
- The section is driven in a real browser against a running server, since `run` is what this
  repo asks for before a non-trivial UI change.
