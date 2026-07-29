// Whether a directory can be a spawn's working directory — and if not, WHY — without spawning.
//
// The sibling of has-binary.ts, for the same reason (#1063): on macOS node-pty never reports
// this. `chdir` runs in the CHILD, after the fork, so a directory that has been deleted arrives
// as an exit code with no output — and under tmux even the pane's own message is wiped by the
// alt-screen restore on the way out. A deleted project, a renamed one, a pruned git worktree and
// a stale `cwdPresets` entry all land here, and all of them look like "it just does not start".
import { statSync } from "node:fs";

/** What the filesystem says about a candidate working directory. `unknown` is not a failure —
 *  it is this process being unable to answer (a permission error, a broken mount). */
export type CwdKind = "directory" | "file" | "missing" | "unknown";

export type CwdProbe = (dir: string) => CwdKind;

export type CwdDiagnosis = { kind: "ok" } | { kind: "missing" } | { kind: "not-a-directory" };

export const fsCwdProbe: CwdProbe = (dir) => {
  try {
    // Symlinks followed, because `chdir` follows them too — a link to a live directory is fine.
    const stat = statSync(dir, { throwIfNoEntry: false });
    if (!stat) return "missing";
    return stat.isDirectory() ? "directory" : "file";
  } catch {
    return "unknown";
  }
};

/** A relative path needs no special case: the child inherits OUR working directory and only then
 *  chdirs, so `statSync` resolves it against the same base the child will. */
export function diagnoseSpawnCwd(cwd: string, probe: CwdProbe = fsCwdProbe): CwdDiagnosis {
  if (!cwd) return { kind: "ok" }; // node-pty falls back to our own cwd, which exists by definition
  const kind = probe(cwd);
  if (kind === "missing") return { kind: "missing" };
  if (kind === "file") return { kind: "not-a-directory" };
  // A directory, or a probe that could not answer. The second must pass: a preflight that cannot
  // answer must never be the thing that refuses a spawn (the rule has-binary.ts states).
  return { kind: "ok" };
}

/** What to tell the user, or null when nothing is wrong. */
export function cwdProblemMessage(cwd: string, diagnosis: CwdDiagnosis): string | null {
  if (diagnosis.kind === "ok") return null;
  if (diagnosis.kind === "not-a-directory") return `${cwd} is a file, not a directory, so nothing can be started in it.`;
  return `The directory ${cwd} no longer exists, so nothing can be started in it — it may have been deleted, renamed, or removed along with its git worktree.`;
}
