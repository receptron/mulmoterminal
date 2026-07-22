// What happens on a terminal connection once it exists: handing a live PTY to a new
// socket, dispatching the frames a browser sends, and deciding the PTY's fate when the
// socket goes away. Split from index.ts (#548 step 3d) — shared by every terminal
// endpoint (/ws, /ws/launch, /ws/codex), so it comes out ahead of the handlers.
//
// The reap decisions stay in index.ts and arrive as deps: they read activity state and
// schedule timers that outlive any one connection.
import type { IPty } from "node-pty";
import type { WebSocket } from "ws";
import { messageOf } from "../errors.js";
import { isResizeFrame } from "./ws-frames.js";
import { stripTerminalQueries } from "./terminal-replay.js";
import type { PtyEntry } from "./types.js";

/** A frame as it arrives off the socket. Only `toString()` is used — ws hands us a
 *  Buffer, and narrowing to this lets a test pass one without a live connection. */
export type WireFrame = { toString(): string };

export interface ConnectionDeps {
  /** A reattach inside the grace window keeps the session alive. */
  cancelReap: (id: string) => void;
  /** Explicit close from the client — tear down now, don't wait out the grace. */
  reap: (id: string) => void;
  setWaiting: (id: string, waiting: boolean) => void;
  /** Socket gone: keep, grace, or reap according to what the session was doing. */
  armReapForDetached: (id: string) => void;
}

// browser -> command PTY. Like handleClientFrame but for the session-less command
// terminal: only input/resize (no terminate/session machinery).
export function handleCommandFrame(term: IPty, raw: WireFrame) {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return; // not JSON — never write arbitrary payloads to the PTY
  }
  try {
    if (msg.type === "input" && typeof msg.data === "string") {
      term.write(msg.data);
    } else if (isResizeFrame(msg)) {
      term.resize(msg.cols, msg.rows);
    }
  } catch (err) {
    console.warn(`[ws/run] dropped message: ${messageOf(err)}`);
  }
}

export function createConnectionHandlers(deps: ConnectionDeps) {
  // Reattach a live background PTY to a new socket: drop any stale socket, swap in
  // the new one, and replay the buffered tail for context.
  function reattachPty(entry: PtyEntry, ws: WebSocket, sessionId: string): PtyEntry {
    deps.cancelReap(sessionId); // a reattach within the grace window keeps the session
    console.log(`[ws] reattach ${sessionId} (pid=${entry.term.pid})`);
    // Drop any socket still attached (e.g. the same session open in another tab).
    // Tell it it's been superseded FIRST so it stops instead of auto-reconnecting —
    // otherwise two clients on one session ping-pong (each reattach kicks the other,
    // the kicked one reconnects, …) into a storm.
    if (entry.ws && entry.ws !== ws && entry.ws.readyState === entry.ws.OPEN) {
      try {
        entry.ws.send(JSON.stringify({ type: "superseded" }));
      } catch {
        // socket already going away — closing below is enough
      }
      entry.ws.close();
    }
    entry.ws = ws;
    if (entry.buffer && ws.readyState === ws.OPEN) {
      // Strip terminal queries from the replay so xterm doesn't re-answer them as stray input
      // (e.g. a DA reply surfacing as "0;276;0c" in the prompt) — see terminal-replay.ts.
      ws.send(JSON.stringify({ type: "output", data: stripTerminalQueries(entry.buffer) }));
    }
    return entry;
  }

  // browser -> PTY. The protocol is client-controlled, so validate every frame
  // before touching node-pty (bad cols/rows or non-string input can throw).
  function handleClientFrame(entry: PtyEntry, ws: WebSocket, raw: WireFrame, sessionId: string) {
    // Ignore frames from a socket that a newer client has already superseded.
    if (entry.ws !== ws) return;
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // not JSON — never write arbitrary payloads to the PTY
    }
    try {
      if (msg.type === "terminate") {
        // Explicit close (the cell's ✕) — reap now instead of waiting out the
        // disconnect grace window, so the session slot frees immediately.
        deps.reap(sessionId);
      } else if (msg.type === "view" && typeof msg.active === "boolean") {
        // The user's focus moved onto/off this pane (a grid cell zoomed/opened, or
        // blurred). An active pane suppresses the attention flag and marks it read;
        // an inactive grid cell can surface blocked/done among its siblings.
        entry.active = msg.active;
        if (msg.active) deps.setWaiting(sessionId, false);
      } else if (msg.type === "input" && typeof msg.data === "string") {
        entry.term.write(msg.data);
      } else if (isResizeFrame(msg)) {
        entry.term.resize(msg.cols, msg.rows);
      }
    } catch (err) {
      // e.g. a write/resize that races the PTY exiting — drop it, never crash.
      console.warn(`[ws] dropped message for ${sessionId}: ${messageOf(err)}`);
    }
  }

  // Socket closed: detach it and decide the PTY's fate by activity — working stays
  // alive, needs-the-user gets a long grace, idle gets the short grace.
  function handleClientClose(entry: PtyEntry, ws: WebSocket, sessionId: string) {
    // Ignore if a newer client already reattached to this session.
    if (entry.ws !== ws) return;
    entry.ws = null;
    // A session with no live socket is by definition not being viewed. Clear `active`
    // so an UNCLEAN disconnect (crash / network drop / killed tab, where the client
    // can't send `view active:false`) can't leave the attention flag suppressed until
    // reconnect. A reattach re-asserts `active` (attach default + the client's view frame).
    entry.active = false;
    // Keep a working session alive indefinitely, give a session that needs the user
    // the long grace, and reap a genuinely idle one after the short grace. A reload
    // reconnects in a moment and re-attaches (cancelling the reap) regardless.
    console.log(`[ws] disconnected ${sessionId}`);
    deps.armReapForDetached(sessionId);
  }
  return { reattachPty, handleClientFrame, handleClientClose };
}
