// A cell whose terminal runs on another MulmoTerminal (#3506). Only its terminal travels through
// the gateway; everything else a cell does asks THIS server, with the cell's cwd or session id. For a
// remote cell that path names a directory on the other machine and the id a session this server has
// never seen, so the call reads, writes or deletes the wrong thing. Until those features are routed
// to the remote, they are withheld here.
import type { CellAction } from "../../common/headerActions";
import { remoteHostSessionRoute, remotePath, remoteSessionKey } from "../../common/remoteHosts";

export const isRemoteHost = (host: string | null | undefined): host is string => typeof host === "string" && host.length > 0;

/** `value` for a local cell, null for a remote one: what this server may be asked about. */
export const onThisMachine = <T>(host: string | null | undefined, value: T | null): T | null => (isRemoteHost(host) ? null : value);

// Every cell action, decided. A Record so that a new action is a type error until someone says
// whether it can run on a remote cell. True only where nothing reaches this server with the cell's
// cwd or session: arranging the grid, typing into the terminal, and closing the cell.
const ON_REMOTE_CELL: Record<CellAction, boolean> = {
  "zoom-toggle": true,
  "mark-unread": true,
  "terminal-move-prev": true,
  "terminal-move-next": true,
  "terminal-park": true,
  "terminal-close": true,
  "terminal-voice": true,
  "terminal-new-here": false,
  "terminal-new-adjacent": false,
  "terminal-restart": false,
  "terminal-timeline": false,
  "terminal-talk": false,
  "terminal-copy-code": false,
  "terminal-insert-path": false,
  "terminal-reveal": false,
  "terminal-diff": false,
  "terminal-note": false,
  "terminal-send-turn": false,
  "terminal-send-since": false,
  "terminal-bring-turn": false,
  "terminal-bring-since": false,
  "pane-files": false,
  "pane-prompts": false,
  "pane-transcript": false,
  "pane-tools": false,
  "pane-canvas": false,
  "pane-collections": false,
};

export const cellActionAllowed = (host: string | null | undefined, action: CellAction): boolean => !isRemoteHost(host) || ON_REMOTE_CELL[action];

/** A terminal endpoint path as this browser reaches it: through the gateway for a remote cell. */
export const terminalPathFor = (host: string | null | undefined, path: string): string => (isRemoteHost(host) ? remotePath(host, path) : path);

export const REMOTE_CELL_DECLINE_EN = "This terminal runs on another machine, so that is not available here yet.";

/** A remote cell's session, as the remote's rows name it. */
export interface RemoteCellSession {
  host: string;
  id: string;
}

export const remoteCellSessions = (cells: readonly { session: string | null; remoteHost?: string | undefined }[]): RemoteCellSession[] =>
  cells.flatMap((cell) => (isRemoteHost(cell.remoteHost) && cell.session ? [{ host: cell.remoteHost, id: cell.session }] : []));

/** The key a cell's activity is looked up by: its bare id when local, host and id when remote. */
export const activityKeyOf = (cell: { session: string | null; remoteHost?: string | undefined }): string | null =>
  cell.session !== null && isRemoteHost(cell.remoteHost) ? remoteSessionKey(cell.remoteHost, cell.session) : cell.session;

/** Where a cell's session detail is read: this server's route, or the gateway's for a remote cell,
 *  which asks the remote and answers the fields a cell may show (remoteSessionDetailOf). */
export function sessionDetailPath(sessionId: string, agent: string, cwd: string | null, host: string | null | undefined): string {
  const params = new URLSearchParams({ agent });
  if (cwd) params.set("cwd", cwd);
  const route = isRemoteHost(host) ? remoteHostSessionRoute(host, sessionId) : `/api/session/${sessionId}`;
  return `${route}?${params}`;
}
