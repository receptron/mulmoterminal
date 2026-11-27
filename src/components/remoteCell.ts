// A cell whose terminal runs on another MulmoTerminal (#3506). Only its terminal travels through
// the gateway; everything else a cell does asks THIS server, with the cell's cwd or session id. For a
// remote cell that path names a directory on the other machine and the id a session this server has
// never seen, so the call reads, writes or deletes the wrong thing. Until those features are routed
// to the remote, they are withheld here.
import type { CellAction } from "../../common/headerActions";
import type { RightPane } from "./gridCell";
import { remoteHostSessionRoute, remotePath, remoteSessionChannel, remoteSessionKey } from "../../common/remoteHosts";

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
  "terminal-restart": true,
  "terminal-timeline": true,
  "terminal-talk": true,
  "terminal-copy-code": true,
  "terminal-insert-path": false,
  "terminal-reveal": false,
  "terminal-diff": true,
  "terminal-note": true,
  "terminal-send-turn": true,
  "terminal-send-since": true,
  "terminal-bring-turn": true,
  "terminal-bring-since": true,
  "pane-files": true,
  "pane-prompts": true,
  "pane-transcript": true,
  "pane-tools": true,
  "pane-canvas": true,
  "pane-collections": false,
};

export const cellActionAllowed = (host: string | null | undefined, action: CellAction): boolean => !isRemoteHost(host) || ON_REMOTE_CELL[action];

// The panes a remote cell opens: its files, read and written on its host, and its session's prompts,
// conversation, tool calls and cards, read there. Collections read this machine's.
const REMOTE_CELL_PANES: readonly RightPane[] = ["files", "prompts", "transcript", "tools", "canvas"];

export const paneAllowed = (host: string | null | undefined, pane: RightPane): boolean => !isRemoteHost(host) || REMOTE_CELL_PANES.includes(pane);

/** cellActionAllowed for the cell `uid` names; no cell (nothing focused) acts on this machine's defaults. */
export const actionAllowedOn = (cells: readonly { uid: number; remoteHost?: string | undefined }[], uid: number | null, action: CellAction): boolean =>
  cellActionAllowed(uid === null ? undefined : cells.find((cell) => cell.uid === uid)?.remoteHost, action);

/** An endpoint path as this browser reaches it: through the gateway for a remote cell. */
export const pathOnHost = (host: string | null | undefined, path: string): string => (isRemoteHost(host) ? remotePath(host, path) : path);

export const REMOTE_CELL_DECLINE_EN = "This terminal runs on another machine, so that is not available here yet.";

/** A read of one session's own record: this server's route, or the gateway's for a remote cell. */
export const transcriptPath = (
  host: string | null | undefined,
  route: "prompts" | "view" | "timeline" | "last-turn" | "relay" | "relay-mark",
  params: URLSearchParams,
): string => pathOnHost(host, `/api/transcript/${route}?${params.toString()}`);

/** A write to the cell's repo, which names its directory in the body: this server's route, or the
 *  gateway's with that directory in the query too, which the gateway holds the body's paths to. */
export const repoWritePath = (host: string | null | undefined, route: string, cwd: string): string =>
  isRemoteHost(host) ? `${remotePath(host, route)}?cwd=${encodeURIComponent(cwd)}` : route;

/** A write to one session: this server's route, or the gateway's for a remote cell. */
export const sessionWritePath = (host: string | null | undefined, sessionId: string, action: "memo" | "terminate" | "drop"): string =>
  pathOnHost(host, `/api/session/${encodeURIComponent(sessionId)}/${action}`);

/** A remote cell's session, as the remote's rows name it. */
export interface RemoteCellSession {
  host: string;
  id: string;
}

export const remoteCellSessions = (cells: readonly { session: string | null; remoteHost?: string | undefined }[]): RemoteCellSession[] =>
  cells.flatMap((cell) => (isRemoteHost(cell.remoteHost) && cell.session ? [{ host: cell.remoteHost, id: cell.session }] : []));

/** The channel a cell's session draws its cards on: this machine's, or the relay's for a remote cell. */
export const sessionChannelOf = (host: string | null | undefined, sessionId: string): string =>
  isRemoteHost(host) ? remoteSessionChannel(host, "session", sessionId) : `session:${sessionId}`;

/** The channel a cell draws on, or null before it has a session. A remote cell's arrive from its host through the relay. */
export const drawChannelOf = (cell: { session: string | null; remoteHost?: string | undefined }): string | null =>
  cell.session !== null ? sessionChannelOf(cell.remoteHost, cell.session) : null;

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
