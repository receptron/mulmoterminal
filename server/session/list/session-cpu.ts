// How much CPU each session's process tree is using, from two cheap listings taken together:
// `ps -Ao pid=,ppid=,time=` and tmux's pane pids. Pure, so the parsing and the tree walk are
// tested against the shapes both platforms print.
//
// CPU TIME, not `pcpu`: on Linux `pcpu` is the average over the process's whole life, so a dev
// server that was quiet for an hour reads as quiet while it spins now. The change in cumulative
// CPU time between two listings is the same on both platforms.
import type { ProcessRow } from "../../infra/process/process-list.js";

export const childrenByParent = (rows: readonly ProcessRow[]): Map<number, number[]> => {
  const children = new Map<number, number[]>();
  rows.forEach((row) => children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]));
  return children;
};

/** The pane's process and everything below it. A pid seen twice is not walked twice. */
export function processTree(rootPid: number, children: ReadonlyMap<number, readonly number[]>): number[] {
  const seen = new Set<number>();
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return [...seen];
}

/**
 * CPU used per session between two listings, in percent of one core. A pid missing from the
 * earlier listing, or whose time went DOWN (the pid was reused), counts from zero rather than
 * from its whole lifetime — a process that just started has no share of the interval to claim.
 *
 * A process that EXITED between the two listings counts for nothing: its last interval is lost.
 * That under-reads a run made of many short-lived children, on purpose. Folding dead children
 * into their parent (`ps -S`) would instead move a long-lived child's WHOLE lifetime into the
 * parent the moment it exits, which this delta then counts a second time — a spike from nothing.
 * Reading low is the safer failure for a picture.
 */
export function sessionCpuPercent(
  before: readonly ProcessRow[],
  after: readonly ProcessRow[],
  panePids: ReadonlyMap<string, readonly number[]>,
  elapsedSeconds: number,
): Map<string, number> {
  const usage = new Map<string, number>();
  if (elapsedSeconds <= 0) return usage;
  const earlier = new Map(before.map((row) => [row.pid, row.cpuSeconds]));
  const later = new Map(after.map((row) => [row.pid, row.cpuSeconds]));
  const children = childrenByParent(after);
  const spentBy = (pid: number): number => {
    const now = later.get(pid) ?? 0;
    const then = earlier.get(pid);
    return then === undefined || now < then ? 0 : now - then;
  };
  // A session split into several panes has a tree per pane; a pid reached from two is counted once.
  panePids.forEach((roots, sessionId) => {
    const tree = new Set(roots.flatMap((root) => processTree(root, children)));
    const spent = [...tree].reduce((total, pid) => total + spentBy(pid), 0);
    usage.set(sessionId, (spent / elapsedSeconds) * 100);
  });
  return usage;
}
