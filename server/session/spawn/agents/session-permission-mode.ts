// The `--permission-mode` a Claude session runs in when it was started in one of its own (#3334). A
// Library promotion starts in plan mode because it reads another conversation, which may carry
// instructions planted in it; a resume of that session still holds what it read, so it has to come
// back in plan mode too, and the reconnect that resumes it says nothing about how it was started.
import path from "node:path";
import { promises as fs } from "node:fs";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../../../config/env.js";
import { messageOf } from "../../../errors.js";
import { forEachJsonlRecord } from "../../../infra/fs/jsonl-file.js";
import { trackPersistQueue } from "../../reaping/persist-drain.js";
import { permissionModeLine, permissionModeRecord } from "./permission-mode-log.js";

const PERMISSION_MODES_FILE = path.join(MULMOTERMINAL_HOME, "session-permission-modes.jsonl");
const modes = new Map<string, string>();
// Ids this process has already written: hydration reads the file as it was before our append, and
// must not overwrite what was recorded during startup.
const writtenIds = new Set<string>();
const isValidSessionId = (id: string): boolean => SESSION_ID_RE.test(id);

export const sessionPermissionModesHydrated: Promise<void> = (async () => {
  try {
    await forEachJsonlRecord(PERMISSION_MODES_FILE, (parsed) => {
      const record = permissionModeRecord(parsed, isValidSessionId);
      if (record && !writtenIds.has(record.sessionId)) modes.set(record.sessionId, record.permissionMode);
    });
  } catch {
    // absent on first run / unreadable => no session was started in a mode of its own
  }
})();

let persist: Promise<void> = Promise.resolve();
trackPersistQueue(() => persist);

function rememberPermissionMode(sessionId: string, permissionMode: string): void {
  if (!isValidSessionId(sessionId) || modes.get(sessionId) === permissionMode) return;
  writtenIds.add(sessionId);
  modes.set(sessionId, permissionMode);
  persist = persist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(PERMISSION_MODES_FILE, permissionModeLine({ sessionId, permissionMode })))
    .catch((e) => console.error(`[session-permission-modes] failed to persist: ${messageOf(e)}`));
}

/** The mode this spawn of `sessionId` runs in, or null for the server's. A mode asked for is
 *  remembered for the id, so every later spawn of it, a resume included, runs in it again. */
export function sessionPermissionMode(sessionId: string, asked: string | undefined): string | null {
  if (asked !== undefined) rememberPermissionMode(sessionId, asked);
  return modes.get(sessionId) ?? asked ?? null;
}
