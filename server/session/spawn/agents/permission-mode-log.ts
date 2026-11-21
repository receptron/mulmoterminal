// The `--permission-mode` a session was started in instead of the server's (#3334), as read from and
// written to disk. It outlives the pty for gui-group-restriction-log.ts's reason: a resume arrives as
// a plain reconnect, and only this record says the session was started in another mode.
//
// Its own append log, for the reasons custom-agent-log.ts gives.

export interface SessionPermissionMode {
  sessionId: string;
  permissionMode: string;
}

const PERMISSION_MODE = /^[A-Za-z]{1,32}$/;

/** One line of the log. */
export function permissionModeLine(record: SessionPermissionMode): string {
  return `${JSON.stringify(record)}\n`;
}

/** The record a parsed line holds, or null for anything unusable. */
export function permissionModeRecord(parsed: Record<string, unknown>, isValidSessionId: (id: string) => boolean): SessionPermissionMode | null {
  const { sessionId, permissionMode } = parsed;
  if (typeof sessionId !== "string" || !isValidSessionId(sessionId)) return null;
  if (typeof permissionMode !== "string" || !PERMISSION_MODE.test(permissionMode)) return null;
  return { sessionId, permissionMode };
}
