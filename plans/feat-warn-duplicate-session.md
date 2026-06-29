# feat: warn before resuming a session already open in another grid terminal

## Problem

In the grid view you can open several terminal cells. When you point a new cell
at the same directory and pick a session from its "resume here" list, you can
**accidentally resume a session that is already open in another cell**. The new
attach silently supersedes the old one (server `reattachPty` sends `superseded`
and closes the previous socket), so the cell you were working in is detached
without any heads-up *before* it happens — only the kicked side learns about it,
after the fact.

## Goal

Before opening such a session, **warn and confirm**:

1. Mark resumable rows that are already open in another terminal so the risk is
   visible *before* the click.
2. On click, show a confirm dialog; only attach if the user accepts (which will
   detach the other terminal, as today).

Scope (confirmed with the user): the in-app grid view, multiple terminals on the
same dir accidentally sharing a session. Cross-process (a second `mulmoterminal`
instance on the same cwd) is out of scope here.

## Approach

Detection is client-side and local to the grid — the grid state already knows
every cell's session id (across all pages; off-page cells stay live as
background PTYs, so resuming one of them would kick it too).

- **GridView.vue** — compute the in-use session ids from `state.cells` and pass
  them down.
- **TerminalGrid.vue** — forward the list to each `TerminalCell`.
- **TerminalCell.vue**
  - new optional prop `openSessionIds?: string[]`.
  - helper `sessionOpenElsewhere(id)` = id is in `openSessionIds` and is not this
    cell's own current session.
  - resume list: add an `● open` marker on rows that are open elsewhere.
  - `resume(s)`: if open elsewhere, `window.confirm(...)` (same pattern already
    used for the dirty-worktree close) and bail on cancel.

No server change: the supersede behavior stays; we only add a pre-flight warning.

## Tests

- `TerminalCell.spec.ts`
  - a resumable row whose id is in `openSessionIds` shows the `● open` marker;
    others don't.
  - clicking an open-elsewhere row with `window.confirm` stubbed to `false` does
    **not** launch (no session handed to the terminal); stubbed to `true` does.
  - a normal (not-open-elsewhere) row resumes without any confirm.
