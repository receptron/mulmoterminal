import { spawnSync } from "node:child_process";

// `cwd` matters for tools whose answer depends on the directory they run in — `claude mcp`
// reads and writes LOCAL-scope config keyed by exactly that. Omitted, the child inherits ours.
//
// stderr is returned SEPARATELY, never folded in: callers here read stdout as data (a keychain
// secret, a docker label), and a warning printed alongside a successful run would corrupt it.
export function spawnCapture(bin: string, args: string[], cwd?: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(bin, args, { encoding: "utf8", cwd });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
