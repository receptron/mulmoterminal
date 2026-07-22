// The wire protocol between a PTY and the browser: what we send down a socket, and what
// we accept coming back up. Split from index.ts (#548) ahead of the spawn functions that
// use it — none of it touches session state, and all of it is worth pinning, because a
// frame that goes out on a closing socket throws and a resize frame that isn't bounded
// reaches node-pty unchecked.

// The socket surface these helpers actually use. Narrower than ws's WebSocket (which
// satisfies it structurally) so a test can hand in a fake instead of a live connection.
export interface FrameSocket {
  readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
}

// Bounds a resize frame must satisfy before it reaches the PTY: a crafted or buggy
// client must not be able to ask for a 0-column or absurdly large terminal.
const MIN_TERM_COLS = 2;
const MAX_TERM_COLS = 500;
const MIN_TERM_ROWS = 1;
const MAX_TERM_ROWS = 200;

/** A well-formed `resize` frame with both dimensions inside the allowed bounds. */
export function isResizeFrame(msg: { type?: unknown; cols?: unknown; rows?: unknown }): msg is { type: "resize"; cols: number; rows: number } {
  if (msg.type !== "resize" || !Number.isInteger(msg.cols) || !Number.isInteger(msg.rows)) return false;
  const cols = Number(msg.cols);
  const rows = Number(msg.rows);
  return cols >= MIN_TERM_COLS && cols <= MAX_TERM_COLS && rows >= MIN_TERM_ROWS && rows <= MAX_TERM_ROWS;
}

// Send a JSON frame if the socket is still there and open. Null-tolerant so the PTY
// handlers don't each repeat the readyState guard; reports whether it went out.
export function sendFrame(socket: FrameSocket | null | undefined, payload: unknown): boolean {
  if (!socket || socket.readyState !== socket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

// Report a PTY exit to the browser, then hang up — shared by every PTY kind. The
// socket is read at exit time because a reattach can swap it after wiring.
export function sendExitAndClose(socket: FrameSocket | null | undefined, exitCode: number, signal: number | undefined): void {
  if (sendFrame(socket, { type: "exit", exitCode, signal })) socket?.close();
}

// Send a terminal error to the socket and close it (no reconnect on the client side).
export function closeWithError(ws: FrameSocket, message: string): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: "error", message }));
    ws.close();
  }
}
