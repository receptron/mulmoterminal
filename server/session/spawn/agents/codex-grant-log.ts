// What the sandbox of a server-started codex was widened by at spawn (#3464), as read from and written
// to disk. It outlives the pty for gui-group-restriction-log.ts's reason: a cold resume arrives as a
// plain reconnect, and only this record says the session was started with more than the user's own
// codex config.
//
// Its own append log, for the reasons custom-agent-log.ts gives.
import path from "node:path";

export interface CodexSandboxGrants {
  networkAccess: boolean;
  neverAsk: boolean;
  writableRoots: readonly string[];
}

export interface CodexSessionGrants extends CodexSandboxGrants {
  sessionId: string;
}

export const NO_CODEX_GRANTS: CodexSandboxGrants = { networkAccess: false, neverAsk: false, writableRoots: [] };

export const grantsAnything = (grants: CodexSandboxGrants): boolean => grants.networkAccess || grants.neverAsk || grants.writableRoots.length > 0;

/** One line of the log. */
export function codexGrantLine(record: CodexSessionGrants): string {
  return `${JSON.stringify(record)}\n`;
}

const isAbsolutePath = (value: unknown): value is string => typeof value === "string" && path.isAbsolute(value);

/** The record a parsed line holds, or null for anything unusable. Voiding a line is the safe side
 *  here: no record means the user's own sandbox, which is narrower than any grant. */
export function codexGrantRecord(parsed: Record<string, unknown>, isValidSessionId: (id: string) => boolean): CodexSessionGrants | null {
  const { sessionId, networkAccess, neverAsk, writableRoots } = parsed;
  if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) return null;
  if (typeof networkAccess !== "boolean" || typeof neverAsk !== "boolean") return null;
  if (!Array.isArray(writableRoots) || !writableRoots.every(isAbsolutePath)) return null;
  return { sessionId, networkAccess, neverAsk, writableRoots };
}
