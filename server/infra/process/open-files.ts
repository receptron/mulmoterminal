// The files a set of processes holds open FOR WRITING, from one `lsof` call. `-F an` prints one
// field per line with a one-letter tag: `f` starts a descriptor, `a` is its access (`r`, `w`, `u`
// for read-write, blank for cwd/txt), `n` its name. The parse is pure and pinned.
import { spawnCaptureAsync } from "./spawnCapture.js";

const LSOF_TIMEOUT_MS = 5_000;
const WRITABLE = new Set(["w", "u"]);

export function parseLsofWritableNames(stdout: string): string[] {
  const names: string[] = [];
  let access = "";
  stdout.split("\n").forEach((line) => {
    if (line.startsWith("f")) access = "";
    else if (line.startsWith("a")) access = line.slice(1);
    else if (line.startsWith("n") && line.length > 1 && WRITABLE.has(access)) names.push(line.slice(1));
  });
  return names;
}

/** Every path the pids hold open for writing, or null when lsof could not give a whole answer: not
 *  installed (Windows), timed out, or cut short. A pid that exited before the call also makes lsof
 *  exit non-zero; reading that as "cannot tell" errs toward attributing nothing. */
export async function writableFilesOf(pids: readonly number[]): Promise<string[] | null> {
  if (pids.length === 0) return [];
  const r = await spawnCaptureAsync("lsof", ["-n", "-P", "-w", "-F", "an", "-p", pids.join(",")], { timeoutMs: LSOF_TIMEOUT_MS });
  return r.status === 0 ? parseLsofWritableNames(r.stdout) : null;
}
