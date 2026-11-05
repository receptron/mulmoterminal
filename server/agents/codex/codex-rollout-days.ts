import path from "node:path";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function dayDir(root: string, when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return path.join(root, String(when.getFullYear()), month, day);
}

// Today + yesterday cover a session spawned "now" (a spawn racing midnight). codex fixes a rollout's
// path when the session STARTS, not when its first turn writes it, so a watcher that has run past a
// day also needs the day it started in.
export function rolloutDayDirs(root: string, now: Date, startedAt: Date = now): string[] {
  const days = [now, new Date(now.getTime() - ONE_DAY_MS), startedAt];
  return [...new Set(days.map((when) => dayDir(root, when)))];
}
