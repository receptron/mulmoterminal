// Where a session's agent is working RIGHT NOW, as opposed to the directory its PTY was
// spawned in. Claude reports its live cwd in every hook payload, so a session that moves
// into another git work tree mid-run (a worktree the agent created, or one it was sent to)
// can say so — but this value is for DISPLAY ONLY.
//
// `PtyEntry.cwd` deliberately stays the spawn dir: it is where the process actually runs, and
// every reattach, tmux lookup and file-serving check is written against it.
//
// It is NOT, despite what this comment first claimed, where the session's transcript lives. The
// CLI MOVES that file to the new directory's project dir when the session changes cwd, which is
// why a moved session stops resolving as reattachable and its cockpit reads zero — see
// plans/live-cwd-header.md. Making the transcript reads follow is a separate change; what
// matters here is that "where the process was started" and "which directory the session is
// about" are two questions, and they stopped having one answer.
import { gitTopLevel } from "../git/worktrees.js";
import { ptys } from "./registry.js";
import { sendFrame, type FrameSocket } from "./ws-frames.js";

// id -> the directory to display, already rounded to its work-tree root.
const liveCwds = new Map<string, string>();

// dir -> its work-tree root (null: not a git work tree). A hook fires on EVERY tool call,
// and a directory's work-tree root only changes when git's layout does, so re-running
// `rev-parse` per hook would spawn a process per tool use to re-learn a constant.
const workTreeRoots = new Map<string, string | null>();

/**
 * The work-tree root `dir` belongs to, or `dir` itself when it is not in a git work tree.
 *
 * Rounding is what keeps the header still. A tool that runs in `<repo>/app` is the same
 * work tree as one that runs in `<repo>`, and a header that redrew per `cd` would be noise
 * rather than information — the question it answers is "which checkout", not "which folder".
 */
export async function workTreeRootOf(dir: string): Promise<string> {
  if (!workTreeRoots.has(dir)) workTreeRoots.set(dir, await gitTopLevel(dir));
  return workTreeRoots.get(dir) ?? dir;
}

/** The live directory a session last reported, or null when it has never reported one. */
export function liveCwd(id: string): string | null {
  return liveCwds.get(id) ?? null;
}

/** Drop a torn-down session's directory (called from reap, alongside the other per-id tables). */
export function forgetLiveCwd(id: string): void {
  liveCwds.delete(id);
}

/** Tell a browser which directory to show for a session. */
export function sendLiveCwd(socket: FrameSocket | null | undefined, id: string, cwd: string): boolean {
  return sendFrame(socket, { type: "cwd", id, cwd });
}

/**
 * Tell a freshly-attached browser about a move that happened before it connected.
 *
 * The `session` frame reports the session's IDENTITY, which does not move. Without this a
 * reload would put the header back on the directory the agent left — and it would STAY there,
 * because `noteLiveCwd` only speaks on a CHANGE and the server already believes it has said
 * this. One missed frame is otherwise permanent; this is what makes it recoverable.
 *
 * Deliberately NOT gated on the connection being a recognised reattach. That gate looked like
 * caution and was the whole bug: a session whose agent has moved no longer resolves as
 * reattachable — its transcript moved to the new directory's project dir, so the
 * exists-on-disk check fails and the socket is logged as "new" — which is exactly the session
 * that needs replaying. What keeps this safe is not the connection kind but the map: an id
 * only has an entry while its session is alive, because reap forgets it.
 */
export function replayLiveCwd(socket: FrameSocket | null | undefined, id: string, reportedCwd: string): boolean {
  const moved = liveCwd(id);
  return !!moved && moved !== reportedCwd && sendLiveCwd(socket, id, moved);
}

/**
 * Which directory to display, given where a hook says the agent is and where its PTY was
 * spawned. Inside the SPAWN work tree the answer is the spawn dir unchanged — a session
 * that never left keeps the exact header it has today, including one started in a
 * subdirectory, so rounding cannot quietly rewrite a display nobody asked to change. Once
 * the agent is in a different work tree, that tree's root is the answer.
 */
export async function displayCwdFor(hookCwd: string, spawnCwd: string): Promise<string> {
  const root = await workTreeRootOf(hookCwd);
  return root === (await workTreeRootOf(spawnCwd)) ? spawnCwd : root;
}

/**
 * Record where a hook says a session is, and push it to that session's browser when it
 * changed. Live sessions only: an id with no PTY has no socket to tell and no reap to
 * forget it, so remembering one would only grow the map.
 */
export async function noteLiveCwd(id: string, hookCwd: unknown): Promise<void> {
  if (typeof hookCwd !== "string" || !hookCwd) return;
  const entry = ptys.get(id);
  if (!entry) return;
  const next = await displayCwdFor(hookCwd, entry.cwd);
  // Absent means "has not moved", i.e. the spawn dir — so the first hook of a session that
  // stayed put sends nothing, rather than a frame restating what the browser already shows.
  const previous = liveCwds.get(id) ?? entry.cwd;
  liveCwds.set(id, next);
  if (next === previous) return;
  sendLiveCwd(entry.ws, id, next);
}
