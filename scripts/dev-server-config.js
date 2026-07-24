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
