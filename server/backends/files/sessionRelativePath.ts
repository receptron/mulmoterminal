// What a tool's RELATIVE `path` means in MulmoTerminal: relative to the directory the calling
// session runs in (see presentPathRoot.ts for why). One rule, asked by the dispatch-route
// rewrite and by manageJingleScript's file ops, so the two cannot disagree about which file a
// relative score path names.
import path from "node:path";
import { classifyFilePath } from "@mulmoclaude/core/artifacts";

// `artifacts/…` is the workspace's own output area: the plugins route those values to
// `files.artifacts` (a root fixed at <workspace>/artifacts), and it is where saveNewDoc
// and executeHtml put a document they just created. Re-rooting them at the session cwd
// would mean a tool could not re-open the document it had just saved.
function isWorkspaceArtifactPath(value: string): boolean {
  return value.split(/[/\\]/)[0] === "artifacts";
}

/** `value` resolved against `cwd` when it is a usable relative path with one of `extensions`;
 *  otherwise `value` itself — an absolute path, `artifacts/…`, and anything core's own gate
 *  would refuse (rewriting that would launder a bad path into a valid absolute one). */
export function sessionRelativePath(value: string, cwd: string, extensions: readonly string[]): string {
  if (classifyFilePath(value, extensions) !== "relative") return value;
  if (isWorkspaceArtifactPath(value)) return value;
  return path.resolve(cwd, value);
}
