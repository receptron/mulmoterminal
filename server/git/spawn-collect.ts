import { spawn } from "node:child_process";

export interface SpawnResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Run a local dev tool (git / gh) with argv only — no shell — and collect its output.
// The tool name is a caller-supplied argument, not a string literal, so this isn't a
// spawn-of-a-string-literal from PATH. Never rejects: a spawn failure resolves ok:false
// with `errorStderr`, so callers branch on the result instead of catching.
export function spawnCollect(bin: string, args: string[], opts: { cwd?: string; errorStderr: string }): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", () => resolve({ ok: false, stdout: "", stderr: opts.errorStderr }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}
