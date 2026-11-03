// Whether the grid is in a state where a path clicked in terminal output can open in the
// Files pane (#910). Split out of TerminalGrid because it is a decision, not wiring — and
// because every "no" here is a case where the pane would otherwise show the wrong file.
//
// Saying no costs the user nothing: the click keeps the route it had before (a new tab, or
// the full-screen Files view), so these can be strict.

export interface PaneClickState {
  /** Is there room for the pane on screen? Always beside an enlarged cell; on the tiled grid only
   *  while a pane is already up beside the tiles (#3027) — a click must not open one there. */
  roomForPane: boolean;
  /** The project dir of the cell the pane answers for — the enlarged one, else the one it is on. */
  paneCellCwd: string | null;
  /** The dir the pane's tree is ACTUALLY rooted at — null before it has first opened. It
   *  trails `paneCellCwd` when a re-root could not be saved out of, and a path relative to
   *  that cell would then resolve against the directory the pane stayed on. */
  paneCwd: string | null;
}

/** Can a click from the session running in `cwd` be shown in the pane right now? */
export function paneCanShowClick(state: PaneClickState, cwd: string): boolean {
  if (!state.roomForPane) return false;
  // Every cell stays mounted while one is enlarged (the filmstrip), and every tile is on screen
  // beside a tiled pane, so a click can come from a cell the pane is not about.
  if (state.paneCellCwd !== cwd) return false;
  return state.paneCwd === null || state.paneCwd === cwd;
}

export interface TiledClickState {
  /** Beside an enlarged cell the pane is the click's first stop already; this rule is the tiled grid's. */
  zoomed: boolean;
  /** The `fileLinkOpensPane` setting (#3238): off keeps a tiled-grid click on its old route. */
  fileLinkOpensPane: boolean;
}

/** The cell to open the pane beside for a click on the tiled grid (#3238), or null to leave the click
 *  to `paneCanShowClick` and the route. The click's cell has to be one of this grid's, and its
 *  directory the one the path was read against: a session that just changed directory reports the
 *  new one before the cell does, and the path would resolve against the wrong root. */
export function paneToOpenBeside(state: TiledClickState, from: { uid: number; cwd: string | null } | undefined, cwd: string): number | null {
  if (state.zoomed || !state.fileLinkOpensPane || from === undefined) return null;
  return from.cwd === cwd ? from.uid : null;
}
