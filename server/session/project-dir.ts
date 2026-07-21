import os from "node:os";
import path from "node:path";

// Claude Code owns the name of the directory it stores a project's transcripts in;
// we only mirror the rule to FIND what it already wrote. A mismatch throws nothing —
// it reads as "this project has no sessions yet", so --resume silently restarts a
// session and the roster/cost views come back empty. That is why this mirrors the
// upstream implementation character for character (claude 2.1.216) and is pinned by tests.

// Beyond this, claude truncates and appends a hash of the full path to keep the
// name a legal directory entry.
const MAX_ENCODED_LENGTH = 200;

// Claude's 32-bit rolling hash (h * 31 + c, wrapped to int32), rendered base36. The
// exact arithmetic matters: a different hash points at a different directory.
function pathHash(absolutePath: string): string {
  let hash = 0;
  for (let i = 0; i < absolutePath.length; i++) {
    hash = ((hash << 5) - hash + absolutePath.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** The directory name claude stores `absolutePath`'s transcripts under. Every
 *  non-alphanumeric character folds to "-", so distinct paths can collide — that is
 *  upstream's scheme, not ours. Takes an already-absolute path so the rule stays
 *  independent of the host platform's separator. */
export function encodeProjectDirName(absolutePath: string): string {
  const encoded = absolutePath.replace(/[^a-zA-Z0-9]/g, "-");
  if (encoded.length <= MAX_ENCODED_LENGTH) return encoded;
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${pathHash(absolutePath)}`;
}

/** Where claude keeps `cwd`'s session transcripts: ~/.claude/projects/<encoded-cwd>/ */
export function projectSessionsDir(cwd: string): string {
  return path.join(os.homedir(), ".claude", "projects", encodeProjectDirName(path.resolve(cwd)));
}
