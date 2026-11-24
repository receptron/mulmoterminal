// manageJingleScript's `files.byPath`: the score a call names, and the files the plugin keeps
// (@gui-chat-plugin/jinglescript 1.5), both relative to the CALLING SESSION's directory.
//
// The plugin registry builds each tool's files context once, at load, so the session cannot be
// a parameter of these ops. It rides in an AsyncLocalStorage instead, entered by the middleware
// below for this one tool's dispatch route; every other tool's dispatch is untouched. The store
// follows the plugin's own awaits, so a write made after the response (a deferred render) still
// lands in the session that asked for it.
//
// Unlike presentPathRoot.ts, the relative value is NOT rewritten in the request: the plugin
// tells the model `jinglescript/<stem>.json` and later compares the `path` it is handed with
// that exact string to recognise a composed score as the render's own. An absolute value would
// fail the comparison and the render would be named `<stem>-2`.
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { Express, NextFunction, Request, Response } from "express";
import type { FileOps } from "gui-chat-protocol";
import { hasErrnoCode } from "../../errors.js";
import { createFileOps } from "./fileOps.js";
import { jingleScriptByPath, openPathWorkspace } from "./openPath.js";
import { JINGLESCRIPT_FILES_DIR, jingleScriptFileTarget } from "./jinglescriptFilePath.js";
import { SESSION_HEADER, sessionIdFromHeader } from "./presentPathRoot.js";

const JINGLESCRIPT_TOOL_ROUTE = "/api/plugin/manageJingleScript";

const callerCwd = new AsyncLocalStorage<string>();

/** Run `fn` as a call from a session working in `cwd`. */
export function runAsJingleScriptCaller<T>(cwd: string, fn: () => T): T {
  return callerCwd.run(cwd, fn);
}

// A call that came through no dispatch route (a test, a direct execute) names no session, and
// gets the workspace — what cwdForSession answers for a request without one.
const cwdOfCall = (): string => callerCwd.getStore() ?? openPathWorkspace();

const filesRoot = (): string => path.join(cwdOfCall(), JINGLESCRIPT_FILES_DIR);
const filesArea = createFileOps(filesRoot, "jinglescript");

// createFileOps trusts its root's own realpath. This root sits in the session's directory, where the
// agent can put a link, so a `jinglescript` that is not a plain directory must not become that root.
async function assertPlainFilesRoot(): Promise<void> {
  const root = filesRoot();
  try {
    const stat = await lstat(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`jinglescript files area is not a plain directory: ${root}`);
  } catch (error) {
    if (hasErrnoCode(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function routed<T>(value: string, operation: (ops: FileOps, key: string) => Promise<T>): Promise<T> {
  const target = jingleScriptFileTarget(value, cwdOfCall());
  if (target === null) return Promise.reject(new Error(`invalid path: ${value}`));
  if (target.area === "score") return operation(jingleScriptByPath, target.value);
  return assertPlainFilesRoot().then(() => operation(filesArea, target.name));
}

const unsupported = (operation: string) => (): Promise<never> => Promise.reject(new Error(`manageJingleScript files do not support ${operation}`));

export const jingleScriptFileOps: FileOps = {
  read: (value) => routed(value, (ops, key) => ops.read(key)),
  readBytes: (value) => routed(value, (ops, key) => ops.readBytes(key)),
  write: (value, content) => routed(value, (ops, key) => ops.write(key, content)),
  stat: (value) => routed(value, (ops, key) => ops.stat(key)),
  exists: (value) => (jingleScriptFileTarget(value, cwdOfCall()) === null ? Promise.resolve(false) : routed(value, (ops, key) => ops.exists(key))),
  readDir: unsupported("readDir"),
  unlink: unsupported("unlink"),
};

/** Enter the calling session's directory for manageJingleScript's dispatch. MUST be registered
 *  before the /api/plugin/:toolName catch-all that executes the tool. */
export function mountJingleScriptCaller(app: Express, deps: { cwdForSession: (id: string | null) => string }): void {
  app.post(JINGLESCRIPT_TOOL_ROUTE, (req: Request, _res: Response, next: NextFunction) => {
    runAsJingleScriptCaller(deps.cwdForSession(sessionIdFromHeader(req.get(SESSION_HEADER))), next);
  });
}
