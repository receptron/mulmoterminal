// A filesystem-safe, per-workspace key derived from a workspace's absolute path — what
// names this workspace's directory under ~/.mulmoterminal.
//
// A path can't be used as a filename raw: on Windows it carries `\` and `:`, which are a
// separator and a stream marker, so the write would fail (or land somewhere unintended)
// and Windows would silently lose whatever was filed under it. Fold everything unsafe to
// "-" and keep a digest of the real path, since folding alone would let two workspaces
// collide.
import path from "node:path";
import { createHash } from "node:crypto";

const SLUG_MAX = 60;
const DIGEST_LEN = 8;

/** The key naming this workspace's own directory. Resolved first, so two spellings of one
 *  directory (a trailing slash, a `.` segment) answer the same key rather than splitting
 *  the workspace's state across two of them. */
export function workspaceKey(workspace: string): string {
  const resolved = path.resolve(workspace);
  const slug = resolved
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX);
  const digest = createHash("sha256").update(resolved).digest("hex").slice(0, DIGEST_LEN);
  return `${slug}-${digest}`;
}
