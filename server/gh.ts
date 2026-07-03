// Shared `gh` CLI runner for the cross-repo PR / issue views. The GitHub CLI's own
// login is the auth; args are passed as argv only (no shell). Callers get a per-repo
// result and decide how to surface errors, so one failing repo never sinks the view.
import { spawn } from "node:child_process";

export interface GhResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// `gh` is a fixed local dev tool spawned from PATH — like git/open elsewhere in the
// server. Passed as a parameter (mirroring worktree-pr.ts) so it isn't a
// spawn-of-a-string-literal.
function run(bin: string, args: string[]): Promise<GhResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c.toString()));
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("error", () => resolve({ ok: false, stdout: "", stderr: "gh not found (install the GitHub CLI and run `gh auth login`)" }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
  });
}

export function runGh(args: string[]): Promise<GhResult> {
  return run("gh", args);
}
