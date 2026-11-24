// The wire protocol between a PTY and the browser: what we send down a socket, and what
// we accept coming back up. Split from index.ts (#548) ahead of the spawn functions that
// use it — none of it touches session state, and all of it is worth pinning, because a
// frame that goes out on a closing socket throws and a resize frame that isn't bounded
// reaches node-pty unchecked.

import { isUsableTerminalSize } from "../../common/terminalSize.js";

// The socket surface these helpers actually use. Narrower than ws's WebSocket (which
// satisfies it structurally) so a test can hand in a fake instead of a live connection.
export interface FrameSocket {
  readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
}

/** A well-formed `resize` frame with both dimensions inside the allowed bounds — the same bounds
 *  the connect URL's geometry is held to (common/terminalSize.ts), because they answer one
 *  question: which sizes may reach node-pty at all. */
export function isResizeFrame(msg: { type?: unknown; cols?: unknown; rows?: unknown }): msg is { type: "resize"; cols: number; rows: number } {
  if (msg.type !== "resize" || !Number.isInteger(msg.cols) || !Number.isInteger(msg.rows)) return false;
  return isUsableTerminalSize({ cols: Number(msg.cols), rows: Number(msg.rows) });
}

// Send a JSON frame if the socket is still there and open. Null-tolerant so the PTY
// handlers don't each repeat the readyState guard; reports whether it went out.
export function sendFrame(socket: FrameSocket | null | undefined, payload: unknown): boolean {
  if (!socket || socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

// Report a PTY exit to the browser, then hang up — shared by every PTY kind. The
// socket is read at exit time because a reattach can swap it after wiring. `ended` says the
// session itself is over, which a pty's exit alone does not (see pty-exit.ts).
export interface PtyExitReport {
  exitCode: number;
  signal: number | undefined;
  lifetimeMs: number;
  /** The pty attached to a program already running, so `lifetimeMs` is not the program's. */
  reattached: boolean;
  ended: boolean;
  /** The agent's exit should have been recorded and was not (a full disk), so its code says nothing. */
  exitUnrecorded: boolean;
}

export function sendExitAndClose(socket: FrameSocket | null | undefined, report: PtyExitReport): void {
  if (sendFrame(socket, { type: "exit", ...report })) socket?.close();
}

// Send a terminal error to the socket and close it (no reconnect on the client side).
export function closeWithError(ws: FrameSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
  }
}
