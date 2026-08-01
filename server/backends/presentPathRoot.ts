// Make presentDocument / presentHtml's RELATIVE `path` argument mean "relative to the
// directory this session is running in", not "relative to the workspace".
//
// Why this exists: the by-path ops (backends/openPath.ts → @mulmoclaude/core/files)
// resolve a relative value against ONE root, the workspace (CLAUDE_CWD). In MulmoClaude
// that is the only directory there is, so workspace-relative is right. In MulmoTerminal
// every grid cell runs in its own project, so an agent in ~/git/ai/mulmoterminal calling
// presentDocument({ path: "README.md" }) got ~/mulmoclaude/README.md — a different
// project's file, opened silently, with the user's edits written back to it.
//
// The fix is applied at the BOUNDARY (the /api/plugin/<tool> dispatch route) rather than
// by making the root per-request: the two later hops — the View's own dispatch
// (loadDoc/saveDoc/loadHtml/saveHtml) and the iframe's /htmlfile/… request — come from
// the browser and cannot name a session, so a per-request root would fix the tool call
// and then resolve those two against the workspace again. Rewriting to an ABSOLUTE path
// here means everything downstream is session-independent, and a stored tool result
// keeps pointing at the file it actually opened.
import path from "node:path";
import type { Express, Request, Response, NextFunction } from "express";
import { classifyFilePath } from "@mulmoclaude/core/artifacts";
import { MARKDOWN_EXTENSIONS, HTML_EXTENSIONS } from "@mulmoclaude/core/files";
import { isPresentableHtmlPath } from "@mulmoclaude/html-plugin";
import { isRecord } from "../../common/isRecord.js";
import { SESSION_ID_RE } from "../config/env.js";
import { isSamePath } from "../infra/path-within.js";

/** Request header carrying the chat session a tool call belongs to. Set by the MCP
 *  broker (server/mcp/broker.ts), which is the only caller that knows it. */
export const SESSION_HEADER = "x-mulmoterminal-session";

/** The tools whose `path` argument this applies to, with the extensions each accepts —
 *  the same lists their by-path FileOps are built with, so the lexical gate below asks
 *  exactly the question core will ask again downstream.
 *
 *  A Map, not an object, for the reason plugins-registry.ts uses one for its dispatch
 *  table: a tool named `constructor` or `__proto__` reads a truthy member off
 *  Object.prototype through index access, and would arrive here as an "extension list"
 *  that is really a function. */
export const PRESENT_PATH_EXTENSIONS = new Map<string, readonly string[]>([
  ["presentDocument", MARKDOWN_EXTENSIONS],
  ["presentHtml", HTML_EXTENSIONS],
]);

// `artifacts/…` is the workspace's own output area: the plugins route those values to
// `files.artifacts` (a root fixed at <workspace>/artifacts), and it is where saveNewDoc
// and executeHtml put a document they just created. Re-rooting them at the session cwd
// would mean a tool could not re-open the document it had just saved.
function isWorkspaceArtifactPath(value: string): boolean {
  return value.split(/[/\\]/)[0] === "artifacts";
}

/**
 * `args` with a relative `path` resolved against `cwd`, or `args` untouched.
 *
 * Left alone deliberately, each for its own reason:
 *   - a View dispatch (`kind` present) — it is the browser talking, replaying a path
 *     that came out of a tool result; it names no session, so there is no cwd to use
 *     that is better than the one core already applies.
 *   - a value core's own gate would refuse (wrong extension, `.`/`..`/empty segment,
 *     NUL) — rewriting it here would either launder a bad path into a valid absolute
 *     one or duplicate a rule that belongs to core. Let the existing validation fail it.
 *   - an already-absolute path, and `artifacts/…` (see above).
 */
export function absolutizePresentPath(args: unknown, cwd: string, extensions: readonly string[]): unknown {
  if (!isRecord(args) || typeof args.kind === "string") return args;
  const value = args.path;
  if (typeof value !== "string" || value === "") return args;
  if (classifyFilePath(value, extensions) !== "relative") return args;
  if (isWorkspaceArtifactPath(value)) return args;
  return { ...args, path: path.resolve(cwd, value) };
}

/** Why a page under a dot-prefixed directory cannot be presented, for the agent that
 *  asked for one. `isPresentableHtmlPath` refuses a dotfile SEGMENT, and it is right to:
 *  the `/htmlfile` mount that hands the page to the iframe refuses them too, so a call
 *  accepted here would report success for a page that can never render. Once the path is
 *  absolute, the session's own directory contributes segments — and MulmoTerminal's
 *  managed worktrees live under `~/.mulmoterminal/worktrees/…`, so this is a place real
 *  sessions run. Said plainly, because "invalid path: /Users/…/report.html" reads like a
 *  typo in an argument that was in fact correct. */
function undisplayableHtmlPath(absPath: string): string {
  return (
    `Cannot display ${absPath}: the /htmlfile mount refuses paths with a dot-prefixed segment, ` +
    `so this page cannot be served to the view. This session's directory has one. Present a page ` +
    `outside that directory, or use presentDocument for a markdown file (which does not go through that mount).`
  );
}

/** Rewrite the body of a presentDocument / presentHtml tool call before any route sees
 *  it. MUST be registered after `express.json` and BEFORE every /api/plugin handler —
 *  the html and mulmoscript dispatch routes included, so one rule covers whichever of
 *  them ends up taking the request. Any other tool passes through untouched.
 *
 *  A session whose directory IS the workspace is left alone rather than rewritten to the
 *  same file's absolute path, and that is not just an optimisation: the markdown View
 *  resolves a document's relative image refs (`![](images/x.png)`) against the document's
 *  own directory and serves them workspace-relative through /api/files/raw, which an
 *  absolute document path breaks. Keeping the workspace case byte-identical means nothing
 *  that works today stops working — including every caller that names no session, which
 *  resolves to the workspace anyway. (A document in ANOTHER project still loses its
 *  relative images; there is no way to say "this cwd" in that URL, and today those refs
 *  resolve against the wrong project entirely.) */
export function mountPresentPathRoot(app: Express, deps: { cwdForSession: (id: string | null) => string; workspace: string }): void {
  app.post("/api/plugin/:toolName", (req: Request, res: Response, next: NextFunction) => {
    const toolName = req.params.toolName;
    const extensions = typeof toolName === "string" ? PRESENT_PATH_EXTENSIONS.get(toolName) : undefined;
    if (!extensions) return next();
    const header = req.get(SESSION_HEADER);
    const sessionId = header && SESSION_ID_RE.test(header) ? header : null;
    const cwd = deps.cwdForSession(sessionId);
    if (isSamePath(cwd, deps.workspace)) return next();

    const rewritten = absolutizePresentPath(req.body, cwd, extensions);
    if (rewritten !== req.body && toolName === "presentHtml") {
      const absPath = (rewritten as { path: string }).path;
      // The plugin's own gate, asked here rather than re-implemented — a path it will
      // refuse deserves the reason, not `invalid path`.
      if (!isPresentableHtmlPath(absPath)) return res.status(400).json({ error: undisplayableHtmlPath(absPath) });
    }
    req.body = rewritten;
    next();
  });
}
