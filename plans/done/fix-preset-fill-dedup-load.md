# fix: don't double-fetch the resume/scripts/worktrees lists on a preset fill

Follow-up to #360 / #361 (surfaced in an independent post-merge review).

## Problem

`fillDir(path)` loads the resume / scripts / worktrees lists **immediately**, and also sets
`dirInput.value = path` — which triggers the `watch([dirInput, …])` that **debounces (300ms)
and loads the same three lists again**. So every preset main-click / folder pick fetched each
list twice. Correctness was fine (`resumableReq` request-token guard + idempotent GETs), but it
was wasteful — and #361 made `fillDir` the primary path (every preset click), so it happened on
the common flow.

## Fix

A one-shot `skipDirWatch` flag: `fillDir` sets it (only when the value actually changes, so a
same-value click can't leave a stale flag that swallows the next real reload) and loads
immediately; the watch consumes the flag and returns without scheduling its debounced reload.
Typing in the field is unaffected (no flag → normal 300ms debounce).

## Files (client-only)

- `src/components/TerminalCell.vue`: add `skipDirWatch`; set it in `fillDir` on a real change;
  honor + reset it at the top of the dirInput watch.
- `src/components/TerminalCell.spec.ts`: fake-timer test — a preset fill loads `/api/sessions`
  exactly once (immediate), and the 300ms watch does not re-fetch.

## Acceptance

- A preset fill loads each list once (immediate), not twice.
- Typing still debounce-loads normally.
- Gates green (format / lint / typecheck / build / test).
