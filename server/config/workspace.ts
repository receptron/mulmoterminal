import { statSync } from "node:fs";
import path from "node:path";
import { CLAUDE_CWD } from "./env.js";

// Validate a client-supplied workspace dir: must be an absolute, existing
// directory. Anything else (relative, missing, a file) falls back to CLAUDE_CWD,
// so a cell can launch a terminal in a chosen dir without trusting raw input.
export function resolveWorkspace(cwd: string | null): string {
  if (cwd && path.isAbsolute(cwd)) {
    try {
      if (statSync(cwd).isDirectory()) return cwd;
    } catch {
      // not a dir / doesn't exist — fall through
    }
  }
  return CLAUDE_CWD;
}

// Every `?cwd=` route resolves the same way: a string query param or the default
// workspace. Shared so a route can't accidentally skip the validation above.
export function workspaceFromQuery(cwd: unknown): string {
  return resolveWorkspace(typeof cwd === "string" ? cwd : null);
}
