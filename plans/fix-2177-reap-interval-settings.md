# fix(#2177): the sweep interval reaches Settings, and the row stops promising "next start"

## What was wrong

#2167 added `sessionReapIntervalHours`, so the idle sweep runs on a timer as well as at boot.
The server took the whole change; the client took none of it.

**1. The number exists only for people who open `config.json`.** The threshold (days) has a
stepper beside the list it acts on — Settings → *Sessions that survived a restart* — and the
interval has nothing. `settings-coverage.spec.ts` records this: `sessionIdleReapDays` carries
`ui: true` and `sessionReapIntervalHours` does not. The default is `0` (off), so a feature that
must be turned on is reachable only by hand-editing a file.

**2. The issue also asks for the row's wording to change, and that half is NOT done here** —
because doing it as specified would ship a second false sentence. See below.

## The part worth checking, which changed what this PR does

The issue proposes switching three strings — the `doomed` badge, its tooltip, and the hint under
the stepper — to "next sweep" whenever `sessionReapIntervalHours > 0`. Checking whether that is
true turned up two facts that pull in opposite directions.

**True:** the badge and the sweep answer the same question. `surviving-sessions.ts` computes
`reapable` with `reapableTmuxSession({ liveHere: ptys.has(key), … })`, and
`reap-idle-sessions.ts` calls that same predicate with the same `ptys` registry. So the timer
sweep being *weaker* than the boot sweep — it cannot touch a session this process holds a pty
for — would not make "ends on the next sweep" a lie: a row holding a live pty here never shows
the badge at all.

**False, and decisive:** the timer is armed ONCE, at boot. `startReapSchedule` takes
`intervalHours` as a plain number while it takes `idleDays` as a function, and
`config-routes.ts` spells out why — *"re-arming on every config POST would let a stream of edits
reset the countdown forever."* So a saved interval is a statement about the NEXT start, and
between saving and restarting no sweep repeats at all.

Switching the badge on the saved value would therefore put "ends on the next sweep" on a row
that will not be swept until the next start — a new false sentence, for exactly the person who
just turned the feature on, which is the defect this issue is about. Saying it truthfully needs
the server to report what it ARMED, and nothing records that anywhere.

So this PR does item 1, tells the truth about when the value applies, and leaves item 2 to a
follow-up that can add the boot signal. The component spec pins the badge's current wording with
that reasoning attached, so the next reader does not "fix" it back.

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
- The hint beside it says which start the value applies from, rather than implying it is
  already in force.
- `settings-coverage.spec.ts` records the key as having UI — not a bookkeeping flip: the check
  greps the UI tree for a real `postConfigField("…")` write, and fails without one.
- `mulmoterminal-config`'s SKILL.md loses its "Config-file only; there is no Settings control"
  bullet and gains the reason the badges still say "next start".

Nothing server-side changed. `app-config.ts` and `config-routes.ts` already carried the field
end to end.

## Deliberately not done

The default stays `0`. #2167 decided that a running server should not start ending sessions
because someone upgraded, and a Settings control does not change the argument.

The row wording (issue item 2) — see above. It needs a boot-time signal, and the files that
would carry it are where #2178 is working.

## Verification

Break-verified rather than assumed — three mutations, each turning a test red, source restored
byte-identical after:

- the wording switch reinstated (2 red), the `:disabled` dropped (1 red), and the save pointed at
  the wrong config field (1 red, and it also fails `settings-coverage.spec.ts`, which is how that
  `ui: true` flip was shown to be a real check rather than bookkeeping).

Driven in a real browser against a real server, with `HOME` pointed at a scratch dir so the
maintainer's own config is never touched — worth saying twice, because the first attempt was NOT
isolated: `npx` resets `HOME`, the backend came up on the real `~/.mulmoterminal/config.json`,
and it was caught by the directory list showing 28 real presets. Running the binary directly
instead of through `npx` fixed it, and isolation was then confirmed by asking the server
(`cwdPresets: 0`) before clicking anything.

What the browser checked: the stepper exists; the hint reads "Only at server start." at 0 and
names the next start once raised; the value reaches `config.json` on disk; and with the
threshold at 0 the stepper is disabled, says why, and a forced click writes nothing.
