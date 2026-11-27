# fix: GridView.vue over max-lines on main (#3588)

## Cause

#3580 and #3581 each kept `src/components/GridView.vue` within `max-lines` (600, comments and blank
lines skipped). Merged together they put it one code line over, so `yarn lint` / `lint:ci` fail on
`main`, Windows daily included.

## Fix

Move `drawChannelOf` (a cell's draw channel, or null before it has a session) from `GridView.vue` to
`src/components/remoteCell.ts`, next to `sessionChannelOf`, which it wraps. The expression is
unchanged; the parameter is the structural `{ session, remoteHost? }` shape the module's other cell
helpers take, which `Cell` satisfies.

Not unified with `TerminalGrid.vue`'s own channel expression: that one tests `cell?.session`
(truthy), so an empty session id answers differently.

## Verification

- `remoteCell.spec.ts`: null before a session, local / empty-host / remote channels, and an empty
  session id counted as a session.
- One-off differential (not committed): the old inline expression and the moved function agree on
  every combination of generated sessions (null, empty, ids with `:` and spaces) and hosts
  (absent, empty, names).
- `yarn lint` passes; `yarn typecheck`, `yarn build`, `yarn test`.
