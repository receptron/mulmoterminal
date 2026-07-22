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
