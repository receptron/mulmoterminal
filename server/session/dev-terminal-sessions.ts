// The set of grid/dev-terminal session ids, as it is read from and written back to disk.
//
// The set exists to keep a grid cell's transcript out of the chat sidebar — the "chat
// hijacked my multi-terminal session" bug — so an id going missing brings that back.
//
// It is shared between INSTANCES, not just between requests. MULMOTERMINAL_HOME is
// ~/.mulmoterminal for every server on the machine, and launching twice is the ordinary way
// to get two: the launcher falls back to another port when the default is busy. Writing the
// in-memory set alone therefore drops whatever a peer added since we booted, so a write
// unions with what is on disk first — the same thing POST /api/config does, for the same
// reason (#611 B1).
//
// A union is the whole answer only because the set is append-only: nothing removes an id, so
// there is no removal for a peer's copy to resurrect.

/** Ids from a parsed file, keeping only what is usable as a session id (and a filename). */
export function parseDevTerminalSessionIds(raw: unknown, isValidId: (id: string) => boolean): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && isValidId(id));
}

/** What to write: everything on disk plus everything we know, in a stable order. */
export function mergeDevTerminalSessionIds(onDisk: readonly string[], inMemory: Iterable<string>): string[] {
  return [...new Set([...onDisk, ...inMemory])].sort();
}
