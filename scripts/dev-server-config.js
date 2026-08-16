// Pure decisions for the dev backend supervisor (scripts/dev-server.mjs), split out so the
// two invariants Codex flagged can be pinned without spawning a real backend: which dirs are
// watched (a stale one means edits to common/ or bin/ don't reload), and whether a (re)start
// should be scheduled (the guard that collapses an overlapping crash + file-change into a
// single spawn instead of racing two backends onto port 34567).
import path from "node:path";

/**
 * The directories whose source changes trigger a reload. The backend imports repo code from
 * common/ and bin/ (e.g. server/config/config-schema.ts -> ../../common/modelIds.ts,
 * server/config/update-status.ts -> ../../bin/update-check.js), so all three must be watched to
 * match what `node --watch` covered. DEV_SERVER_WATCH overrides with a single dir (test only).
 * @param {Record<string, string | undefined>} env
 * @param {string} root
 * @returns {string[]}
 */
export function resolveWatchDirs(env, root) {
  if (env.DEV_SERVER_WATCH) return [path.resolve(env.DEV_SERVER_WATCH)];
  return ["server", "common", "bin"].map((d) => path.join(root, d));
}

/**
 * Whether a fresh backend should be scheduled now. False while shutting down, and false when one
 * is already scheduled — the idempotency that makes a crash landing inside a file-change debounce
 * collapse to one spawn rather than two.
 * @param {{ shuttingDown: boolean, restartPending: boolean }} state
 * @returns {boolean}
 */
export function shouldSchedule({ shuttingDown, restartPending }) {
  return !shuttingDown && !restartPending;
}

/** A change worth reloading for — source files, not editor temp/swap files. */
export function isReloadableChange(filename) {
  return typeof filename === "string" && /\.(ts|mjs|js|json)$/.test(filename);
}

/** The exit code `server/index.ts` leaves with when the port was already taken. Kept in sync
 *  with `PORT_IN_USE_EXIT_CODE` in server/infra/server-exit.ts, which a spec pins. */
export const PORT_IN_USE_EXIT_CODE = 75;

/**
 * What to do about a backend that just exited: come back, back off, or stop trying.
 *
 * The supervisor used to decide this from HOW FAST the process died, which is the wrong
 * question. The backend does its whole setup — seeding help docs, syncing skills, registering
 * scheduler tasks — BEFORE it binds the port, so a second `yarn dev` on a taken port took ~3s to
 * fail: longer than the fast-crash window, so every exit reset the delay to its minimum and the
 * exponential backoff never once fired. That respawned a 113% CPU boot every 3-4 seconds forever,
 * and on the machine that reported it the load average sat at 75-80 until it was noticed (#1735).
 *
 * So the answer is two rules instead of one timing heuristic:
 *
 * - **A port that is taken will still be taken next time.** Retrying cannot fix it, and each
 *   attempt re-runs setup with real side effects (files copied into the user's home). Stop and
 *   say so; a file change still re-arms the loop, which is how the dev actually recovers.
 * - **Otherwise count CONSECUTIVE failures**, not elapsed time. A slow crash loop is still a
 *   crash loop. `runFor` no longer decides anything; a run that reached the port resets the
 *   count via `restartPlan`'s caller.
 *
 * @param {{ code: number | null, signal: string | null, consecutiveFailures: number,
 *           minDelayMs: number, maxDelayMs: number }} exit
 * @returns {{ retry: boolean, delayMs: number, reason: string }}
 */
export function restartPlan({ code, signal, consecutiveFailures, minDelayMs, maxDelayMs }) {
  if (code === PORT_IN_USE_EXIT_CODE) {
    return {
      retry: false,
      delayMs: 0,
      reason: "the port is already in use — another instance is running. Free it, or set PORT=<n>, then save any source file to retry.",
    };
  }
  const how = signal ? `signal ${signal}` : `code ${code}`;
  // First failure comes back at the floor; each one after doubles it. Doubling from the count
  // rather than from the previous delay means the caller holds no delay state to get stale.
  const delayMs = Math.min(minDelayMs * 2 ** Math.max(0, consecutiveFailures - 1), maxDelayMs);
  const loop = consecutiveFailures > 1 ? ` (${consecutiveFailures} in a row — crash loop? check the stack above)` : "";
  return { retry: true, delayMs, reason: `backend exited (${how}) — restarting in ${delayMs}ms${loop}` };
}

/**
 * Whether a child's IPC message is the backend saying it bound the port.
 *
 * This is what resets the crash count — deliberately NOT elapsed time. The backend does its whole
 * setup before it binds, so "it stayed up N seconds" says nothing about whether the port was ever
 * reached: on a slow machine, or with a pre-bind failure that takes longer than N, every crash
 * would look healthy and the loop would run at the floor forever (#1735).
 *
 * A message from anywhere else must not count, hence the shape check rather than truthiness.
 * @param {unknown} msg
 * @returns {boolean}
 */
export function isListeningMessage(msg) {
  return typeof msg === "object" && msg !== null && /** @type {{ type?: unknown }} */ (msg).type === "listening";
}
