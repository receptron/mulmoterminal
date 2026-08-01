// Make presentDocument / presentHtml's `path` argument mean what the AGENT meant by it.
//
// Both tools take "workspace-relative or absolute", and the workspace is CLAUDE_CWD — the
// one directory the server was started in. But a MulmoTerminal grid runs sessions in MANY
// directories (each cell has its own cwd), and an agent sitting in one of them writes
// `docs/report.html` meaning "relative to where I am", which is the only reading it has any
// reason to expect. Resolved against CLAUDE_CWD that is a file nobody named — usually
// missing, and worse when a file of the same name happens to exist there.
//
// So: before the tool call reaches the plugin, a RELATIVE `path` that exists under the
// calling session's own cwd is rewritten to that absolute path. The session comes from the
// header the MCP broker attaches to its dispatch POST (the only thing that knows which
// session made the call — the route itself sees just the args).
//
// Deliberately narrow, because this rewrites an argument the agent supplied:
//   - Only when the file EXISTS under the session cwd. Otherwise the value is left alone and
//     resolves against the workspace exactly as before, so nothing that worked stops working
//     and a bad path still reports itself against the workspace root.
//   - Only for a relative value. An absolute path already means one thing.
//   - Only for the two `path`-taking tools. presentMulmoScript's `filePath` is
//     `artifacts/`-relative by contract and is NOT touched.
//
// Mounted before every /api/plugin route (including the View's own loadHtml/saveHtml and
// loadDoc/saveDoc dispatches, which carry no session header and so pass through unchanged —
// by then the path they hold is already the absolute one this rewrote).
import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { ptys, sessionCwd } from "../session/registry.js";
import { isRecord } from "../../common/isRecord.js";

/** Header the GUI MCP broker stamps on `POST /api/plugin/<tool>` so the route knows which
 *  session the call came from. Defined here because the two ends must agree. */
export const SESSION_HEADER = "x-mulmoterminal-session";

/** The tools whose `path` argument names a file on disk. presentMulmoScript is absent on
 *  purpose — its `filePath` is resolved against `artifacts/`, not a directory. */
const PATH_TOOLS = ["presentDocument", "presentHtml"] as const;

/** Where a session is ACTUALLY running. `ptys` knows where the agent process was spawned and is
 *  the truer answer while it lives; `sessionCwd` is the memo for sessions this process did not
 *  spawn, and survives the reap. A relative path means the directory the agent is sitting in, so
 *  the live pty wins. */
function cwdOfSession(id: string): string | null {
  return ptys.get(id)?.cwd ?? sessionCwd(id);
}

function isRegularFile(abs: string): boolean {
  try {
    // statSync follows symlinks, so a link to a real document counts and a directory
    // named `report.html` does not.
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * The absolute path a relative `value` names inside `sessionCwd`, or null when it should be
 * left as it is — no session cwd, an absolute or NUL-bearing value, or nothing there.
 *
 * Exported for the spec: the whole behaviour is in this decision, and it is worth pinning
 * without an HTTP round-trip.
 */
export function sessionRelativePath(value: unknown, sessionCwdPath: string | null): string | null {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  if (!sessionCwdPath) return null;
  // Absolute under EITHER platform's rules: a Windows-shaped value must not be re-rooted
  // into the session cwd on POSIX (it is refused downstream, which is the right answer).
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.startsWith("\\")) return null;
  const abs = path.resolve(sessionCwdPath, value);
  // `..` can climb out of the session cwd — that is fine (the `path` form is uncontained by
  // design; see backends/openPath.ts), but the file still has to be there.
  return isRegularFile(abs) ? abs : null;
}

/** Rewrite `body.path` in place when the calling session's cwd is where the file actually is. */
function rewritePathArg(req: Request): void {
  const body = req.body;
  if (!isRecord(body) || typeof body.path !== "string") return;
  const sessionId = req.get(SESSION_HEADER);
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) return;
  const resolved = sessionRelativePath(body.path, cwdOfSession(sessionId));
  if (resolved !== null) body.path = resolved;
}

/** Mount the rewrite ahead of every /api/plugin route — the plugin dispatch routes,
 *  the host-answered ones, and the generic catch-all alike. MUST be registered after
 *  `express.json` (it reads the parsed body) and before any of them. */
export function mountSessionRelativePathRewrite(app: Express): void {
  for (const tool of PATH_TOOLS) {
    app.post(`/api/plugin/${tool}`, (req: Request, _res: Response, next: NextFunction) => {
      rewritePathArg(req);
      next();
    });
  }
}
