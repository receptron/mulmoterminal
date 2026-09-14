// Whether an endpoint may take a session that is already running, and how a failed start is
// phrased. Lifted out of ws-routes.ts unchanged — the two are one concept, the checks made between
// resolving a session and spawning it, and ws-routes had reached the file-size limit, which is a
// prompt to name a piece of it rather than to keep appending.
import type { WebSocket } from "ws";
import { ptys } from "../session/registry.js";
import type { EarlyFrames } from "../session/early-frames.js";
import type { PtyEntry } from "../session/types.js";
import type { TerminalWsKind } from "./terminal-ws-path.js";
import { SpawnRefusedError } from "../session/pty-spawn.js";
import { closeWithError } from "../session/ws-frames.js";
import { messageOf } from "../errors.js";

// A refused spawn already carries its own diagnosis — the missing CLI with the PATH that was
// searched (#1063), or the directory that is gone (#1078). Passing that through rather than
// wrapping it is what puts the real reason in the terminal instead of `spawn ENOENT`; everything
// else is an error nobody wrote for a reader, so it gets named.
/** Whether a PTY entry matches the endpoint trying to reattach it.
 *
 *  `ptys` is shared across all agents, so a Claude cell carrying an old shell-entry id
 *  (unrecognized persisted agent coerced to "shell") would silently reattach the launcher's
 *  process. This gate rejects that.
 */
export function wrongEndpointReason(endpoint: TerminalWsKind, entryAgent: PtyEntry["agent"] | undefined): string | null {
  // The run endpoint is ephemeral and owns no sessions, so it has no reattach case.
  if (endpoint === "run") return null;
  // A launcher entry is always "shell", whatever command it runs; the endpoint is "launch".
  if (endpoint === "launch" && entryAgent === "shell") return null;
  // Agent endpoints match iff the endpoint and the entry's recorded agent are identical.
  // If agent is missing (test entries), assume it matches.
  if (entryAgent === undefined || endpoint === entryAgent) return null;
  return `Session is running ${entryAgent}, not ${endpoint}`;
}

/** Check if a live PTY entry is still valid after the async admission awaits (git, filesystem, etc).
 *
 *  A live entry was captured at resolve time before those awaits. If the reap timer fired
 *  mid-admission, the entry is a corpse — reattaching it would wire the browser to a dead pty
 *  while the next connect spawned fresh under the same id. Close plainly so the client reconnects.
 *
 *  Also handles the case where a competing connect spawned the id while this one was being
 *  admitted — serialization handles that (it finds the entry where resolve saw none).
 */
export function settledEntry(
  ws: WebSocket,
  endpoint: TerminalWsKind,
  sessionId: string,
  hadLiveAtResolve: boolean,
  early: EarlyFrames,
): { entry: PtyEntry | undefined } | null {
  const current = ptys.get(sessionId);
  const reason = current ? wrongEndpointReason(endpoint, current.agent) : null;
  if (reason) {
    console.warn(`[ws/${endpoint}] refusing ${sessionId} — ${reason}`);
    // Loud, not a plain close: a plain close makes the client retry the same mismatched id
    // forever with backoff. The mismatch is a persisted-state defect the user has to act on
    // (asTerminalAgent coerces an unrecognised persisted agent to "claude"), and the error frame
    // is what stops the reconnect loop and says why.
    closeWithError(ws, `${reason} — open it from its own agent's cell.`);
    early.discard();
    return null;
  }
  // A resolve-time snapshot that has since died: close plainly so the client reconnects.
  if (hadLiveAtResolve && !current) {
    console.log(`[ws/${endpoint}] ${sessionId} was reaped mid-admission`);
    ws.close();
    early.discard();
    return null;
  }
  // Return what is actually there now, not the resolve-time snapshot — a competing connect
  // may have spawned it while this one was still being admitted.
  return { entry: current };
}

export const startFailureMessageFor =
  (what: string) =>
  (err: unknown): string =>
    err instanceof SpawnRefusedError ? err.message : `Failed to start ${what}: ${messageOf(err)}`;
