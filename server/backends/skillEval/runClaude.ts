// Runs `claude -p` once in a directory with the prompt on stdin, and gives back what it printed
// (#3438). A run that outlives its time is killed with everything it started.
import { spawn } from "node:child_process";

export interface ClaudeRunRequest {
  bin: string;
  args: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
}

export interface ClaudeRunResult {
  stdout: string;
  /** Null when it was killed for running too long or could not start. */
  exitCode: number | null;
  failure: string | null;
}

export type RunClaude = (request: ClaudeRunRequest) => Promise<ClaudeRunResult>;

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

export const runClaude: RunClaude = ({ bin, args, prompt, cwd, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, detached: true, stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (exitCode: number | null, failure: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks).toString("utf8"), exitCode, failure });
    };
    const timer = setTimeout(() => {
      killGroup(child.pid);
      finish(null, `claude ran longer than ${String(timeoutMs)} ms`);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (err) => finish(null, `could not run ${bin}: ${err.message}`));
    child.on("close", (code) => finish(code, null));
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
