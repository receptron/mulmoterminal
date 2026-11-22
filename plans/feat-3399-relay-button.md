# feat: a built-in send button on the cell (#3399)

#3397 made send / bring reachable from a header button, a key and the palette — all of which need
configuring, so the feature stays undiscovered. This puts one button on header row 2, after the copy
button, with no config.

## Why built into the cell, not a default header button

- A configured `buttons` list REPLACES the default set, so a default button misses exactly the users
  who configure things.
- `when` is resolved server-side from that cell's own state; it cannot see which other cells the
  browser has open, so "only when there is a partner" is not expressible there.

## Behaviour

- Shown while this cell can start a talk (`talkStartable`) and has at least one partner (the #3397
  rule: same directory, or anywhere in the repo's worktrees). Otherwise absent.
- One partner: labelled with it (`codex #4`); pressing it runs `terminal-send-turn`.
- Several: labelled with the count; pressing it opens the Talk menu (through the same action).
- `cellSendButton` (global, on unless `false`) hides it; a checkbox in Settings → Header buttons and
  chips.

## Keeping it live

`listSlots()` reads the non-reactive connection runtime. A counter (`slotsVersion.ts`) is bumped by
each cell when its session, directory or connection status changes, and when it unmounts; the
button's partner list is re-read on every bump. The counter lives outside `useTerminalConnections.ts`,
which sits at its file-length bound.

The worktree list is fetched only when some terminal sits outside this cell's directory, and cached
per directory for a minute; pressing the button still resolves the partner fresh (`findPartner`).

## Config plumbing

`cellSendButton` is grouped with `fileLinkOpensPane` in `sanitizeOptOutFlags` / `mergeOptOutFlags`,
so the two key lists in `app-config.ts` stay inside `max-lines-per-function`. The old and new handling
of `fileLinkOpensPane` were compared over every body value and base (`mergeConfigUpdate`) and every
stored value (`loadAppConfig`): no difference.
