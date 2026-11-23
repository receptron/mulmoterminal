import path from "node:path";

/** What the filesystem says about one path. `dangling` is a symlink whose target does not resolve —
 *  most often a link onto a volume that is not mounted, so it must never read as deleted. */
export type DirPresence = "present" | "absent" | "dangling";

/** Saved directories that no longer answer, split by whether that is permanent. */
export interface MissingPresets {
  /** Absent while the parent is present: deleted, so safe to forget. */
  gone: string[];
  /** Out of reach in a way an unplugged drive also produces, so only hidden, never forgotten. */
  unreachable: string[];
}

// Where removable and network volumes are mounted. When one is unplugged its mount directory goes
// away while these stay, so a saved volume root would otherwise look exactly like a deleted folder.
const MOUNT_ROOTS = ["/Volumes", "/media", "/mnt", "/run/media"];
// Linux mounts per user one level deeper (`/media/<user>/<label>`, `/run/media/<user>/<label>`).
const PER_USER_MOUNT_ROOTS = ["/media", "/run/media"];

function isMountContainer(dir: string): boolean {
  return MOUNT_ROOTS.includes(dir) || PER_USER_MOUNT_ROOTS.includes(path.dirname(dir));
}

/** Classify saved directory paths by presence. `probe` must answer `absent` only for a definite
 *  "not there" (ENOENT/ENOTDIR) — anything uncertain has to read as present, or a permission error
 *  would delete a saved entry. Relative paths and filesystem roots are skipped: there is nothing to
 *  resolve the first against, and the second has no parent to judge by. */
export function classifyMissingPresets(paths: readonly string[], probe: (dir: string) => DirPresence): MissingPresets {
  const missing = paths.filter((dir) => path.isAbsolute(dir) && path.dirname(dir) !== dir && probe(dir) !== "present");
  const isGone = (dir: string) => probe(dir) === "absent" && !isMountContainer(path.dirname(dir)) && probe(path.dirname(dir)) === "present";
  return {
    gone: missing.filter(isGone),
    unreachable: missing.filter((dir) => !isGone(dir)),
  };
}
