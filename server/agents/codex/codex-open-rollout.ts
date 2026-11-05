// Which rollout a running codex has OPEN — the evidence for a reattach that lost the cell's mapping
// (#3283). codex keeps its own rollout open for as long as the process lives, idle between turns
// included (measured on codex-cli 0.156.1), so this is the conversation the process is writing, not
// a guess among the rollouts in the same directory (#1533). Exactly one, or nothing.
import path from "node:path";

const ROLLOUT_NAME = /^rollout-.*\.jsonl$/;

/** The sessions root twice: as the rest of the server spells it (what `claimed` holds and what a
 *  rollout path is built from), and resolved, which is how lsof prints it (`/tmp` is `/private/tmp`
 *  on macOS). */
export interface RolloutRoot {
  listed: string;
  canonical: string;
}

// An open path under the root, re-spelled under `listed`, or null when it is not a rollout of this root.
function asListedRollout(openPath: string, root: RolloutRoot): string | null {
  const relative = path.relative(root.canonical, openPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (!ROLLOUT_NAME.test(path.basename(relative))) return null;
  return path.join(root.listed, relative);
}

/**
 * The one rollout among a process tree's open files, or null. Two distinct rollouts open is
 * ambiguous and attributes neither; a single one already claimed by another session is refused
 * rather than shared, since one conversation mapped to two cells would be resumed from both.
 */
export function pickOpenRollout(openPaths: readonly string[], root: RolloutRoot, claimed: ReadonlySet<string>): string | null {
  const rollouts = new Set(openPaths.flatMap((openPath) => asListedRollout(openPath, root) ?? []));
  if (rollouts.size !== 1) return null;
  const [sole] = rollouts;
  return sole === undefined || claimed.has(sole) ? null : sole;
}
