// The files a set of processes has open, from one `lsof` call. `-F n` prints one field per line
// with a one-letter tag, so only the `n` (name) lines are paths; the parse is pure and pinned.
import { spawnCaptureAsync } from "./spawnCapture.js";

const LSOF_TIMEOUT_MS = 5_000;

export function parseLsofNames(stdout: string): string[] {
  return stdout.split("\n").flatMap((line) => (line.startsWith("n") && line.length > 1 ? [line.slice(1)] : []));
}

/** Every path the pids have open, or null when lsof could not answer (not installed, Windows,
 *  timed out). lsof exits 1 when one of the pids has already gone, and still prints the rest, so
 *  an exit status alone is not a failure. */
export async function openFilesOf(pids: readonly number[]): Promise<string[] | null> {
  if (pids.length === 0) return [];
  const r = await spawnCaptureAsync("lsof", ["-n", "-P", "-w", "-F", "n", "-p", pids.join(",")], { timeoutMs: LSOF_TIMEOUT_MS });
  if (r.status !== 0 && r.stdout === "") return null;
  return parseLsofNames(r.stdout);
}
