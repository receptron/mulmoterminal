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

/** What the classifier asks of the filesystem. `presence` must answer `absent` only for a definite
 *  "not there" (ENOENT/ENOTDIR) — anything uncertain has to read as present, or a permission error
 *  would delete a saved entry. `hasEntries` must answer false when unsure, for the same reason. */
export interface DirProbe {
  presence: (dir: string) => DirPresence;
  hasEntries: (dir: string) => boolean;
}

/** Classify saved directory paths by presence. Relative paths and filesystem roots are skipped:
 *  there is nothing to resolve the first against, and the second has no parent to judge by.
 *
 *  An EMPTY parent never proves a deletion: a mount point that stays behind as an empty folder after
 *  an unmount (an fstab `/mnt/nas`, a share mounted under home) looks exactly like that. */
export function classifyMissingPresets(paths: readonly string[], probe: DirProbe): MissingPresets {
  const missing = paths.filter((dir) => path.isAbsolute(dir) && path.dirname(dir) !== dir && probe.presence(dir) !== "present");
  const parentProvesDeletion = (parent: string) => !isMountContainer(parent) && probe.presence(parent) === "present" && probe.hasEntries(parent);
  const isGone = (dir: string) => probe.presence(dir) === "absent" && parentProvesDeletion(path.dirname(dir));
  return {
    gone: missing.filter(isGone),
    unreachable: missing.filter((dir) => !isGone(dir)),
  };
}

/** How long a directory must stay missing before it is forgotten. One "not found" is not proof: a
 *  network share can answer ENOENT for a moment, so the first sighting only hides it. */
export const MISSING_CONFIRM_MS = 24 * 60 * 60 * 1000;

/** What one prune decides: what to forget now, what to hide, and when each still-unconfirmed
 *  deletion was first seen — the record the next prune is judged against. */
export interface PruneDecision {
  gone: string[];
  unreachable: string[];
  missingSince: Record<string, number>;
}

/** A deletion is confirmed only by a SECOND sighting at least `confirmAfter_ms` after the first.
 *  Until then the directory is hidden like an unreachable one. A directory that comes back, or
 *  leaves the list, drops out of the record, so its clock starts again from nothing. */
export function decidePrune(
  paths: readonly string[],
  probe: DirProbe,
  missingSince: Readonly<Record<string, number>>,
  now_ms: number,
  confirmAfter_ms = MISSING_CONFIRM_MS,
): PruneDecision {
  const { gone: suspects, unreachable } = classifyMissingPresets(paths, probe);
  const isConfirmed = (dir: string) => {
    const since = missingSince[dir];
    return since !== undefined && now_ms - since >= confirmAfter_ms;
  };
  const waiting = suspects.filter((dir) => !isConfirmed(dir));
  const hidden = new Set([...unreachable, ...waiting]);
  return {
    gone: suspects.filter(isConfirmed),
    unreachable: paths.filter((dir) => hidden.has(dir)),
    missingSince: Object.fromEntries(waiting.map((dir) => [dir, missingSince[dir] ?? now_ms])),
  };
}
