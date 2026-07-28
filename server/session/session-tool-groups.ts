// Which GUI tool groups each session actually has, as it is read from and written back to disk.
//
// MulmoTerminal cannot know this from its own config: a grid cell's GUI tools come from the
// USER's per-folder MCP config (`claude mcp add -s local`, `.mcp.json`), which we neither
// write nor read. So it is LEARNED — a request arriving on `/api/mcp/<group>/<id>` is proof
// that this session has that group, and there is no earlier or more reliable signal. The
// client's first ListTools lands within a second of the session starting.
//
// Persisted for the same reason the dev-terminal set is: the learning happens in memory, and a
// server restart (a --watch reload) would otherwise forget it while the claude process keeps
// running in tmux — already past its ListTools and with no reason to call again. The panel
// would then decide the cell has no Canvas and hide it on a session that is still drawing.
//
// Same APPEND LOG shape as dev-terminal-sessions.ts, for the same reason: MULMOTERMINAL_HOME
// is shared by every server on the machine, so a read-merge-write loses whichever of two
// instances finishes first. Nothing is ever removed, so appending needs no read.

import { isToolGroup, type ToolGroup } from "../../common/toolGroups.js";

/** One entry of the log: `<session id> <group>`. */
export interface SessionToolGroup {
  sessionId: string;
  group: ToolGroup;
}

function entryFromLine(line: string, isValidId: (id: string) => boolean): SessionToolGroup[] {
  const [sessionId, group, ...rest] = line.trim().split(/\s+/);
  // `rest` non-empty means the line has more than the two fields it should — a truncated
  // append or a hand-edit. Dropped rather than guessed at, like the legacy parser does.
  if (rest.length > 0 || !sessionId || !isValidId(sessionId) || !isToolGroup(group)) return [];
  return [{ sessionId, group }];
}

/**
 * The entries a file holds. Anything unusable is dropped rather than carried along — a bad
 * session id would end up compared against real ones, and a bad group name against a real URL.
 */
export function parseSessionToolGroups(contents: string, isValidId: (id: string) => boolean): SessionToolGroup[] {
  const seen = new Set<string>();
  return contents.split("\n").flatMap((line) => {
    const entries = entryFromLine(line, isValidId);
    return entries.filter(({ sessionId, group }) => {
      const key = `${sessionId} ${group}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
}

/**
 * What to append for a newly learned pair. The newline leads rather than trails for the same
 * reason it does in dev-terminal-sessions.ts: whatever the file ended with, an appended entry
 * starts its own line, so a file that was cut off mid-write costs one entry and not the rest.
 */
export function sessionToolGroupLine(sessionId: string, group: ToolGroup): string {
  return `\n${sessionId} ${group}`;
}
