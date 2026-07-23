# refactor(#676 B4): unify relative-time formatting

Part of #676. Four separate relative-time helpers had drifted apart (floor vs round,
"ago" vs no suffix, different NaN handling). Consolidate the numeric core into the
already-tested `cellDisplay.ts`, standardising on **floor**.

## Decision (user-approved)

- Unify on **floor**. `cellDisplay.relativeTime` (floor, "…ago") is the canonical core.
- `Sidebar` and `PrsOverlay` adopt it directly. Sidebar previously used **round**, so its
  displayed value can now differ by one unit near a boundary — accepted.
- `NotificationBell` keeps its deliberately compact display ("5m", no "ago", 45-second
  just-now cutoff) but shares the floor numeric core.

## Changes

`src/components/cellDisplay.ts`
- `relativeTime(ms, now)` unchanged.
- add `relativeTimeFromIso(iso, now)` — `Date.parse` → NaN yields `""`, else delegates.
- add `compactRelativeTime(ms, now)` — `< 45s` → "just now", else floor to "Nm"/"Nh"/"Nd".
- add `compactRelativeTimeFromIso(iso, now)` — NaN → `""`, else delegates.

`src/components/shortPkg.ts` (new)
- extract `shortPkg` (strip a leading `@scope/`; bare `@scope/` keeps the original).

Components: delete each local helper, import from the core (one-directional; the `.vue`
files import `cellDisplay`/`shortPkg`, never the reverse).
- `Sidebar.vue` → `relativeTime(s.mtime, Date.now())`.
- `PrsOverlay.vue` → `relativeTimeFromIso(x, Date.now())`.
- `NotificationBell.vue` → `compactRelativeTimeFromIso(entry.createdAt, Date.now())` + imported `shortPkg`.

## Tests

- `test/src/components/cellDisplay.spec.ts` extended: `relativeTimeFromIso` (valid + NaN),
  `compactRelativeTime` (44s → just now / 45s boundary → "0m", floor across m/h/d, no "ago",
  future skew), `compactRelativeTimeFromIso`. Existing `relativeTime` tests unchanged.
- `test/src/components/shortPkg.spec.ts` (new): scoped, nested, unscoped, bare-scope, empty.

## Mutation checks (performed, reverted)

- `compactRelativeTime` floor → round: 4 boundary tests red. Reverted.
- 45s cutoff → 60: the 45-second boundary test red. Reverted.

## Note for review

`compactRelativeTime` with floor renders 45–59s as **"0m"** (the previous round rendered
"1m"). This is a transient window in the live bell and is the direct consequence of the
approved floor unification; pinned by a boundary test.
