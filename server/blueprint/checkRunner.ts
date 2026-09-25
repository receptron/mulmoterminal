// Runs a step's check in the project directory. The check is a line the PACK wrote (never a
// request body), run through /bin/sh because packs compose scripts with arguments; the two pack
// directories are handed over as BLUEPRINT_BASE / BLUEPRINT_USECASE so a check can call either.
//
// The check runs with the server's environment, which is the user's: it can do nothing the step's
// own agent could not, since both act as the same user in the same directory.
import { spawn } from "node:child_process";

// A check may build the app or run emulator tests, which is slow; one that hangs must still end.
export const CHECK_TIMEOUT_MS = 15 * 60 * 1000;
// What is kept of the output: the end, where a failing command says why.
export const CHECK_OUTPUT_KEEP_CHARS = 64 * 1024;
// How long to wait for the output pipes after the shell exits. A descendant that left the process
// group (setsid) can hold them open for ever; the shell's exit status is the answer either way.
const PIPE_GRACE_MS = 2000;

export interface CheckRequest {
  command: string;
  cwd: string;
  basePackDir: string;
  usecasePackDir: string;
}

export interface CheckResult {
  ok: boolean;
  output: string;
}

const keepTail = (text: string): string => (text.length > CHECK_OUTPUT_KEEP_CHARS ? text.slice(-CHECK_OUTPUT_KEEP_CHARS) : text);

// The shell is its own process-group leader (detached), so a timeout can end everything it started
// — an emulator's JVM included — not only the shell.
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

export function runCheck({ command, cwd, basePackDir, usecasePackDir }: CheckRequest, timeoutMs: number = CHECK_TIMEOUT_MS): Promise<CheckResult> {
  // Colour off: checks pipe command output into other commands, and a coloured number (FORCE_COLOR
  // makes node's console.log emit one) is not a number — a real run lost its port that way.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== "FORCE_COLOR"));
  const env = { ...inherited, NO_COLOR: "1", BLUEPRINT_BASE: basePackDir, BLUEPRINT_USECASE: usecasePackDir };
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const append = (chunk: Buffer): void => {
      output = keepTail(output + chunk.toString("utf8"));
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (ok: boolean, detail: string): void => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      resolve({ ok, output: [output, detail].filter((part) => part.length > 0).join("\n") });
    };
    const byExitCode = (code: number | null): void => (code === 0 ? finish(true, "") : finish(false, `check exited with ${code}`));
    // Answered on the spot rather than after `close`, which an escaped descendant could hold off.
    timers.push(
      setTimeout(() => {
        killGroup(child.pid);
        finish(false, `check timed out after ${timeoutMs} ms`);
      }, timeoutMs),
    );
    child.on("exit", (code) => {
      killGroup(child.pid);
      timers.push(setTimeout(() => byExitCode(code), PIPE_GRACE_MS));
    });
    child.on("error", (err) => finish(false, `could not run the check: ${err.message}`));
    child.on("close", byExitCode);
  });
}
