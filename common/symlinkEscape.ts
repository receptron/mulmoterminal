// A file route's 403 for a path that is inside the project by its spelling but whose real location
// is not, because a symbolic link on the way leads out (#3301). The server says which of the two
// refusals it was, since only it can see where a link goes; the pane decides from these fields and
// never from the error sentence.
//
// The body also carries the absolute path the server resolved, through the link: the pane may have
// no base to rebuild it from — the full-screen view with no `?cwd=` reads the server's default
// directory, which the request never named.
import { isRecord } from "./isRecord.js";

export const SYMLINK_ESCAPE_FIELD = "escape";
export const SYMLINK_ESCAPE = "symlink";
export const SYMLINK_ESCAPE_PATH_FIELD = "absolutePath";

/** The absolute path a symlink-escape 403 names, or null for any other body. */
export function symlinkEscapePath(body: unknown): string | null {
  if (!isRecord(body) || body[SYMLINK_ESCAPE_FIELD] !== SYMLINK_ESCAPE) return null;
  const absolutePath = body[SYMLINK_ESCAPE_PATH_FIELD];
  return typeof absolutePath === "string" && absolutePath !== "" ? absolutePath : null;
}
