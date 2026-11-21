// Which terminals a send / bring action pairs this cell with (#3397): another agent terminal in the
// same directory, or anywhere inside another worktree of the same repo. A terminal in an unrelated
// directory is left out — the Talk menu still lists every terminal for that.
import type { SlotInfo } from "./readableSlot";

const SEPARATORS = ["/", "\\"];

const trimSeparator = (path: string): string => (path.length > 1 && SEPARATORS.some((sep) => path.endsWith(sep)) ? path.slice(0, -1) : path);

/** `dir` is `root` or somewhere under it. */
export function isWithin(dir: string, root: string): boolean {
  const base = trimSeparator(root);
  const target = trimSeparator(dir);
  return target === base || SEPARATORS.some((sep) => target.startsWith(base + sep));
}

/** `worktreePaths` is every worktree of this cell's repo, its own included; empty outside git. */
export function relayPartners(slots: readonly SlotInfo[], selfKey: string, selfCwd: string | null, worktreePaths: readonly string[]): SlotInfo[] {
  if (!selfCwd) return [];
  const related = (cwd: string): boolean => trimSeparator(cwd) === trimSeparator(selfCwd) || worktreePaths.some((root) => isWithin(cwd, root));
  return slots.filter((slot) => slot.key !== selfKey && slot.cwd !== null && related(slot.cwd));
}
