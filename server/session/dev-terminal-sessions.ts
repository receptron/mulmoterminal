// The set of grid/dev-terminal session ids, as it is read from and written back to disk.
//
// The set exists to keep a grid cell's transcript out of the chat sidebar — the "chat
// hijacked my multi-terminal session" bug — so an id going missing brings that back.
//
// It is shared between INSTANCES, not just between requests. MULMOTERMINAL_HOME is
// ~/.mulmoterminal for every server on the machine, and launching twice is the ordinary way
// to get two: the launcher falls back to another port when the default is busy.
//
// So the file is an APPEND LOG, one id per line, rather than a rewritten snapshot. That is
// what makes it safe without a lock: a snapshot has to be read, merged and written back, and
// two instances doing that at once lose whichever finishes first — narrowing the window does
// not close it. Appending needs no read at all, and an id is the only thing ever added
// (nothing removes one), so there is no ordering to get wrong (#611 B1).
//
// The old format was a single JSON array. It is still read, so an existing file keeps
// working and simply stops being rewritten.

/** One line of the log: a bare id, or the whole legacy JSON array. */
function idsFromLine(line: string, isValidId: (id: string) => boolean): string[] {
  const text = line.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && isValidId(id)) : [];
    } catch {
      return []; // a truncated legacy line is not worth guessing at
    }
  }
  return isValidId(text) ? [text] : [];
}

/**
 * The ids a file holds, in either format. Anything unusable as a session id is dropped
 * rather than carried along — these end up as filenames elsewhere.
 */
export function parseDevTerminalSessionIds(contents: string, isValidId: (id: string) => boolean): string[] {
  const ids = contents.split("\n").flatMap((line) => idsFromLine(line, isValidId));
  return [...new Set(ids)];
}

/**
 * What to append for a newly marked id.
 *
 * The newline goes BEFORE the id, not after. An existing file holds the legacy JSON array
 * with no trailing newline, so appending `<id>\n` would weld the first id onto the end of
 * that array — the line then parses as neither, and every previously hidden session is lost
 * on the next hydrate. Leading it instead means an appended id always starts its own line,
 * whatever the file ended with.
 */
export function devTerminalSessionLine(id: string): string {
  return `\n${id}`;
}
