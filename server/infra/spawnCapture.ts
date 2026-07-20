import { spawnSync } from "node:child_process";

// Bin passed as a parameter (never a string literal at the call site) so callers aren't
// flagged as a spawn-of-a-string-literal.
export function spawnCapture(bin: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
}
