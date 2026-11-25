// The sandbox grants a server-started codex was spawned with (#3464), kept per session id so a cold
// resume of it comes back with them. Same shape as session-permission-mode.ts.
import path from "node:path";
import { promises as fs } from "node:fs";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../../../config/env.js";
import { messageOf } from "../../../errors.js";
import { forEachJsonlRecord } from "../../../infra/fs/jsonl-file.js";
import { trackPersistQueue } from "../../reaping/persist-drain.js";
import { codexGrantLine, codexGrantRecord, grantsAnything, NO_CODEX_GRANTS, type CodexSandboxGrants } from "./codex-grant-log.js";

const CODEX_GRANTS_FILE = path.join(MULMOTERMINAL_HOME, "codex-session-grants.jsonl");
const grantsBySession = new Map<string, CodexSandboxGrants>();
// Ids this process has already written: hydration reads the file as it was before our append, and
// must not overwrite what was recorded during startup.
const writtenIds = new Set<string>();
const isValidSessionId = (id: string): boolean => SESSION_ID_RE.test(id);

export const codexSessionGrantsHydrated: Promise<void> = (async () => {
  try {
    await forEachJsonlRecord(CODEX_GRANTS_FILE, (parsed) => {
      const record = codexGrantRecord(parsed, isValidSessionId);
      if (!record || writtenIds.has(record.sessionId)) return;
      const { sessionId, ...grants } = record;
      grantsBySession.set(sessionId, grants);
    });
  } catch {
    // absent on first run / unreadable => no codex was started with grants
  }
})();

let persist: Promise<void> = Promise.resolve();
trackPersistQueue(() => persist);

const sameGrants = (a: CodexSandboxGrants | undefined, b: CodexSandboxGrants): boolean =>
  a !== undefined && a.networkAccess === b.networkAccess && a.neverAsk === b.neverAsk && a.writableRoots.join("\0") === b.writableRoots.join("\0");

function rememberGrants(sessionId: string, grants: CodexSandboxGrants): void {
  if (!isValidSessionId(sessionId) || sameGrants(grantsBySession.get(sessionId), grants)) return;
  writtenIds.add(sessionId);
  grantsBySession.set(sessionId, grants);
  persist = persist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(CODEX_GRANTS_FILE, codexGrantLine({ sessionId, ...grants })))
    .catch((e) => console.error(`[codex-session-grants] failed to persist: ${messageOf(e)}`));
}

/** The grants this spawn of `sessionId` runs with. Grants asked for are remembered for the id, so
 *  every later spawn of it, a cold resume included, runs with them again. */
export function codexSessionGrants(sessionId: string, asked: CodexSandboxGrants): CodexSandboxGrants {
  if (grantsAnything(asked)) rememberGrants(sessionId, asked);
  return grantsBySession.get(sessionId) ?? NO_CODEX_GRANTS;
}
