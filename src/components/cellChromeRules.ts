// The last of the grid's small display rules: what a failed worktree action says, and when a
// zoom animates.

const REASON_MESSAGES = new Map<string, string>([
  ["not-worktree", "Not a worktree"],
  ["no-branch", "No branch to push"],
  ["no-remote", "No git remote (origin) configured"],
  ["no-github", "Not a GitHub repo — push succeeded; open the PR manually"],
  ["push-failed", "Push failed"],
  ["failed", "Failed"],
]);

// A Map, not an object literal: indexed by a string that arrives in a server response, an
// object would answer `constructor` or `toString` through its prototype chain — and `?? ` does
// not catch a function, so the UI would render "function Object() { [native code] }" where a
// sentence belongs.
export function worktreeFailureMessage(reason?: string | null): string {
  return REASON_MESSAGES.get(reason ?? "") ?? "Failed";
}

// Which cell the zoom transition should fly, given the expanded cell before and after.
export function flipTargetUid(to: number | null | undefined, from: number | null | undefined): number | null {
  return to ?? from ?? null;
}

// Whether that transition should run at all.
//
// Two reasons not to. Swapping between two already-zoomed cells (a cockpit list click) has no
// on-screen source to fly from — the incoming cell sits off-screen in the grid — so the
// animation would start from nowhere. And a user who asked for reduced motion gets none.
export function shouldFlipZoom(to: number | null | undefined, from: number | null | undefined, reducedMotion: boolean): boolean {
  if (flipTargetUid(to, from) === null) return false;
  if (to !== null && to !== undefined && from !== null && from !== undefined) return false;
  return !reducedMotion;
}
