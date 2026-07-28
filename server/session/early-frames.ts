// Frames that arrive before the session they belong to exists.
//
// The browser treats a WebSocket as usable the moment it opens and sends its first frame right
// away — a `resize` carrying the terminal's real geometry (see useTerminalConnections). The
// server, meanwhile, may still be deciding what to spawn: a grid codex cell reads its directory's
// registered tool groups off disk first. Anything that lands in that window is delivered to a
// listener that does not exist yet and is simply lost, and a lost resize leaves the pty on its
// default 80x24 while the browser draws the real size.
//
// So the socket is listened to from the start, into a buffer, and the buffer is replayed in
// arrival order once there is a pty to give it to.
import type { WebSocket } from "ws";

export interface EarlyFrames<T> {
  /** Replay what arrived, in order, and stop buffering. Safe to call when nothing arrived. */
  release: (deliver: (raw: T) => void) => void;
  /** Drop what arrived and stop buffering — for a connection that never gets its session. */
  discard: () => void;
}

export function bufferEarlyFrames<T>(ws: Pick<WebSocket, "on" | "off">): EarlyFrames<T> {
  const pending: T[] = [];
  const collect = (raw: T) => pending.push(raw);
  ws.on("message", collect as (...args: unknown[]) => void);
  const stop = () => ws.off("message", collect as (...args: unknown[]) => void);
  return {
    release(deliver) {
      // Detached BEFORE the replay: a frame arriving mid-replay must reach the real listener the
      // caller is about to install, not land back in a buffer nobody drains again.
      stop();
      for (const raw of pending) deliver(raw);
      pending.length = 0;
    },
    discard() {
      stop();
      pending.length = 0;
    },
  };
}
