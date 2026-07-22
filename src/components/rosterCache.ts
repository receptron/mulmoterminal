// Keeping the roster's two per-cell caches from outliving the cells they describe.
//
// `sessionMeta` (per session) and `phaseByCwd` (per directory) are filled by a poll that
// runs while the roster is on screen, and nothing ever removed from them: a cell that was
// closed, relaunched under a new session id, or pointed at another directory left its entry
// behind for as long as the page stayed open. A grid that gets used all day accumulates one
// per session it ever showed (#620 F5).
//
// Dropping is keyed on what the cells currently ARE, not on what changed, so a key that
// comes back is simply refetched by the next poll.

/** Cached keys that no cell asks for any more. */
export function staleCacheKeys(cached: Iterable<string>, inUse: ReadonlySet<string>): string[] {
  return [...cached].filter((key) => !inUse.has(key));
}

/**
 * What the cleanup watch keys on.
 *
 * Both caches have to retire together, and they are keyed differently: sessionMeta by
 * session, phaseByCwd by directory. Keying the watch on the session ids alone means a cell
 * that keeps its session and only moves directory never fires it, so the old directory's
 * entry stays for as long as the page does.
 *
 * The parts are joined with a NUL, which cannot appear in a session id or a path, so a cwd
 * containing the separator cannot forge a boundary and make two different rosters look alike.
 */
export function rosterCellsKey(cells: readonly { session: string | null; cwd: string | null }[]): string {
  return cells.map((cell) => `${cell.session ?? ""}\u0000${cell.cwd ?? ""}`).join("\u0000\u0000");
}
