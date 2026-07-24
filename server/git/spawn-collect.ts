import { spawn } from "node:child_process";

export interface SpawnResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// A network-backed `gh` call that stalls (no route, an auth prompt, a hung proxy) would
// otherwise pin an HTTP request open and stack subprocesses across retries. Kill it.
const DEFAULT_TIMEOUT_MS = 30_000;

// Run a local dev tool (git / gh) with argv only — no shell — and collect its output.
// The tool name is a caller-supplied argument, not a string literal, so this isn't a
// spawn-of-a-string-literal from PATH. Never rejects: a spawn failure (or timeout) resolves
// ok:false with `errorStderr`, so callers branch on the result instead of catching.
export function spawnCollect(bin: string, args: string[], opts: { cwd?: string; errorStderr: string; timeoutMs?: number }): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    // Collect bytes and decode ONCE at the end: a chunk boundary can fall inside a
    // multibyte UTF-8 character (a Japanese PR title, branch, or commit message), and
    // per-chunk toString() would corrupt it into replacement characters.
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => outChunks.push(c));
    child.stderr.on("data", (c: Buffer) => errChunks.push(c));
    child.on("error", () => resolve({ ok: false, stdout: "", stderr: opts.errorStderr }));
    child.on("close", (code) =>
      resolve({ ok: code === 0, stdout: Buffer.concat(outChunks).toString("utf8"), stderr: Buffer.concat(errChunks).toString("utf8") }),
    );
  });
}
