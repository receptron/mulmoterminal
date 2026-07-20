import { spawnSync } from "node:child_process";

export function spawnCapture(bin: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
}
