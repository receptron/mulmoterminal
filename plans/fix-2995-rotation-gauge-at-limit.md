# fix: an at-limit subscription says so, and the `/login` entry is named beside tokens (#2995)

## What the reporter saw

With token rotation on and two tokens, the header read `a n/a | 5h 2% 7d 0% | b 5h 2% 7d 0%`.
Token a was out of its weekly window; the unnamed gauge was the `/login` account's. Two things
went wrong in the display, and only the display — the server had classified a correctly and
rotation was skipping it.

1. **An at-limit subscription is drawn as `n/a`.** `probeNoteKey` turns the `usage-limit` stall
   into a note, and `accountGauges` drops a reading with no windows, so the one subscription that
   most needs attention reads as "unknown". The reason is on hover only.
2. **The `/login` entry is the only unnamed one on the row.** Beside `b 5h 2% 7d 0%`, an unnamed
   `5h 2% 7d 0%` is indistinguishable from a second copy of b.

Fed to `rateLimitReadout` with the reporter's `/api/rate-limits` body, both reproduce.

## What does NOT reproduce here

The `/login` store holding b's figures. A cell's `--settings` carries hooks and never a
`statusLine`; the one keyless reporter is the `/login` probe itself, which starts on the server's
environment and unsets nothing. A `CLAUDE_CODE_OAUTH_TOKEN` in that environment makes the probe
measure that token. Asked on the issue; not changed here.

## Change

All in the pure readout (`src/composables/rateLimitGauge.ts`), so each rule is a test:

- **At its limit is a state, not an absence.** An account note whose stall is `usage-limit`
  carries `warn: true` and the word for it (`tips.rateLimit.atLimit`) in place of `n/a`; the
  template draws it in the warning colour. The hover keeps the explanation and adds when the
  windows last said they would reset, from `lastLimits` — which the server sends exactly while a
  login is held out.
- **The default login is named once a named login of the same agent shares the row.** The
  `/login` gauge gets the label `/login` (`DEFAULT_LOGIN_SHORT_LABEL`), and its note, when it has
  one, joins the named entries as `/login n/a` / `/login at limit` instead of the unnamed
  `claude usage n/a`. Alone — no accounts, no tokens — nothing changes.
- `tokenUsageRows` shares the at-limit rule (`atUsageLimit`) instead of restating it.

## Deliberately not done

- Hiding the `/login` gauge under `includeDefaultLogin: false`. A launcher chip or a custom agent
  still runs on `/login`, and the gauge is theirs. Naming it is lossless; hiding it is not.
- Skipping the `/login` probe under `includeDefaultLogin: false`. Same reason, and a server-side
  decision for the maintainer.
- Drawing an at-limit subscription as `100%`. Which window is out is not known (the probe is
  refused before any status line), and a figure we cannot vouch for is the one thing this gauge
  must never draw.
