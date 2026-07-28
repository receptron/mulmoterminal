import { spawnSync, execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Long enough for `claude mcp add`, which validates the server it is registering, and short
// enough that a hung CLI surfaces as an error the UI can show rather than a request that never
// answers.
const DEFAULT_TIMEOUT_MS = 15_000;

export interface Captured {
  status: number | null;
  stdout: string;
  stderr: string;
}

// SYNCHRONOUS, and therefore only for callers that run at boot or between requests — a docker
// label, a tmux probe, a keychain read. It blocks the event loop for as long as the child runs,
// so anything reachable from an HTTP handler must use spawnCaptureAsync below instead.
//
// stderr is returned SEPARATELY, never folded in: callers here read stdout as data (a keychain
// secret, a docker label), and a warning printed alongside a successful run would corrupt it.
export function spawnCapture(bin: string, args: string[]): Captured {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

// The request-facing form. `claude mcp` is reached from GET and POST handlers, and the CLI can
// stall (a slow MCP health check, a hung OAuth refresh) — synchronously that would freeze every
// other request on this server, not just the one waiting.
//
// `cwd` matters for tools whose answer depends on the directory they run in: `claude mcp` reads
// and writes LOCAL-scope config keyed by exactly that. Omitted, the child inherits ours.
//
// execFile, not exec: the arguments stay an array, so nothing built from a request body is ever
// parsed by a shell. The timeout kills the child rather than waiting on it forever.
export async function spawnCaptureAsync(bin: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}): Promise<Captured> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { encoding: "utf8", cwd: options.cwd, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    return { status: 0, stdout, stderr };
  } catch (e) {
    // A non-zero exit and a timeout both land here; both carry whatever the child managed to
    // print, which is what the caller reports to the user.
    const err = e as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    return {
      status: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr || err.message || "",
    };
  }
}
