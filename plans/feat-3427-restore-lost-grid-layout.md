# feat: a copy of the grid layout, offered back when the browser lost its own (#3427)

## Problem

Which cells the grid shows lives only in the browser (`localStorage` `grid_v2`). When that is lost —
a full disk the browser could not commit to, a cleared profile, the app opened at another origin —
the grid comes back empty, and nothing offers the cells back.

The sessions themselves do not survive either: a detached idle session is ended after 30 seconds
and one waiting on the user after 30 minutes (`server/session/lifecycle.ts`). So the first idea, offer
the tmux sessions still running, covers almost nothing on a reopen. What is lost is the RECORD of the
cells; with it, each cell resumes its session from its conversation, the same as on a normal reload.

## Design

- **Mirror.** `src/composables/gridLayoutMirror.ts` owns reading and writing the layout. Each save
  writes `grid_v2` as before and, debounced, POSTs it to `/api/grid-layout`, which keeps it at
  `~/.mulmoterminal/grid-layout.json` (atomic write, size cap). A change still unsent when the page
  goes is sent with `sendBeacon`. A browser that cannot store it (quota, full disk) still sends it.
- **Offer.** A grid that loads with no session cells asks `GET /api/grid-layout` and offers the
  saved cells in a bar (`RestoreLayoutBar.vue`): Restore opens each through `openCellAt`, Dismiss
  keeps the empty grid. The saved copy is read with the same `parseGridState` as `grid_v2`.
- **Hold.** While the offer is open the grid sends nothing, not even on leaving: its first change
  would overwrite the copy it is offering. Restore or Dismiss releases it.
- **Left out of the offer:** cells already here, and sessions a terminal is showing now (another
  tab's cells — the GET answers the attached ids), which would otherwise be fought over. Restore asks
  again at the moment it runs, since the bar can sit on screen while another tab opens one of them.
- **A copy that failed to send stays pending**, so leaving the page sends it; no timed retry.
- **The legacy key is dropped only after the new key was stored**, as before the move.

## Accepted limits

- Only cells in the copy are offered. A running session the copy does not hold (the copy was last
  written by another grid, or the session started after the last write) is not discovered here; it
  is still listed under Settings, sessions that survived a restart.
- Last writer wins between two open grids: the copy is whichever grid changed last.
- A cell whose session has no conversation on disk resumes as a new session, as a normal reload does.
- On a full disk the server cannot write either; the copy then holds the layout from before.

## Out of scope

A crash on a full disk closing its own cell is #3424 (PR #3426).
