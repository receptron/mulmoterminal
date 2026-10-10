// What a terminal WebSocket handler does the moment the socket is accepted, before its first await.
//
// The browser sends the terminal's geometry (and its view state) the instant the socket opens,
// and a socket with no `message` listener drops what arrives. The early-frame buffer used to be
// attached at the session announcement, AFTER the admission's awaits — hydration, session
// resolution, the per-session lock, the worktree reservation, the tmux probe, the occupancy read —
// so a cell that mounted beside a pane about to close had its correcting resize dropped in that
// window, and its pty ran at the width the connect URL carried (#2986). Reading the request and
// starting the buffer are one step so that no handler can take the first without the second.
import type { WebSocket } from "ws";
import { CLAUDE_CWD, SESSION_ID_RE } from "../config/env.js";
import { workspaceRequest } from "../config/workspace.js";
import { parseTerminalSize, type TerminalSize } from "../../common/terminalSize.js";
import { bufferEarlyFrames, type EarlyFrames } from "../session/pty/early-frames.js";

// The slice of Node's IncomingMessage the upgrade handlers read. Structural rather than the
// real type so a test can hand over a literal; `| undefined` because IncomingMessage.url is
// genuinely absent on some upgrades.
export type WsUpgradeRequest = { url?: string | undefined; headers?: unknown };

export interface AcceptedTerminalConnection {
  url: URL;
  /** The `?session=` the browser asked for, when it is a well-formed id. */
  requested: string | null;
  cwd: string;
  unusable: string | null;
  /** The geometry the browser has already fitted its terminal to, or null when it sent none it can
   *  stand behind — the same bounds a `resize` frame is held to. */
  size: TerminalSize | null;
  /** Every frame the browser sends from here on, until a pty exists to replay them into. */
  early: EarlyFrames;
}

// The default is still what an unusable `?cwd=` resolves to, because a REATTACH is allowed to
// proceed on it (see refuseUnusableWorkspace) and handing tmux a directory that is not there
// would break the one path this must not break.
export function workspaceFromUrl(url: URL): { cwd: string; unusable: string | null } {
  // getAll, not get: a repeated `?cwd=a&cwd=b` names two directories, and `get` would silently
  // pick the first — the same swap this exists to stop, and the HTTP routes already refuse it
  // (express hands them the array). Passing the array on keeps ONE rule for both transports.
  const values = url.searchParams.getAll("cwd");
  const request = workspaceRequest(values.length > 1 ? values : values[0]);
  if (request.kind === "unusable") return { cwd: CLAUDE_CWD, unusable: request.problem };
  return { cwd: request.cwd, unusable: null };
}

export function acceptTerminalConnection(ws: Pick<WebSocket, "on" | "off">, req: WsUpgradeRequest): AcceptedTerminalConnection {
  const url = new URL(req.url ?? "/", "http://localhost");
  const raw = url.searchParams.get("session");
  const requested = raw && SESSION_ID_RE.test(raw) ? raw : null;
  const size = parseTerminalSize(url.searchParams.get("cols"), url.searchParams.get("rows"));
  return { url, requested, size, ...workspaceFromUrl(url), early: bufferEarlyFrames(ws) };
}
