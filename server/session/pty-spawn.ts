// The low-level ways this server starts a terminal: a bare pty, a tmux-backed one that
// survives the server dying, and the Docker sandbox. Split from index.ts (#548) ahead of
// the spawn functions that build on them — these four depend only on infra, so they move
// without carrying any of index.ts's session state along.
import pty from "node-pty";
import type { IPty } from "node-pty";
import path from "node:path";
import type { WebSocket } from "ws";
import { sanitizePtyEnv } from "../infra/pty-env.js";
import { withoutUnset } from "./provider-env.js";
import { tmuxAvailable, tmuxNewSessionArgs, tmuxScrubEnvNames } from "../infra/tmux.js";
import {
  sandboxEnabled,
  sandboxPlatformSupported,
  dockerAvailable,
  sandboxImageExists,
  buildDockerRunArgs,
  writeSandboxClaudeConfig,
  writeSandboxCredentials,
  cleanupSandbox,
} from "../infra/sandbox.js";
import type { PtyEntry } from "./types.js";

const PTY_COLS = 120;
const PTY_ROWS = 30;

// pty.spawn with the binary as a PARAMETER (never a string literal at the call site),
// so the tmux/shell/claude spawns aren't flagged as spawn-of-a-string-literal.
// The env is sanitized: package-manager launcher vars (yarn's PREFIX kills nvm
// in spawned shells — see infra/pty-env.ts) must not leak into PTYs.
// `unset` drops variables the session must NOT inherit — ANTHROPIC_API_KEY for a provider
// session, which would silently outrank its auth token (#579). It cannot be expressed in
// the settings `env` block, which can set a variable but not remove one.
export function spawnPty(bin: string, args: string[], cwd: string, unset: readonly string[] = []): IPty {
  const env = withoutUnset(sanitizePtyEnv(process.env, path.delimiter), unset);
  return pty.spawn(bin, args, { name: "xterm-256color", cols: PTY_COLS, rows: PTY_ROWS, cwd, env });
}

// Would this session run in the Docker sandbox? Single-view interactive only (the caller
// adds `ws !== null`). Shared by the spawn gate and the connection handler so the
// pre-spawn credential refresh fires exactly when a sandbox spawn will.
export function sandboxWouldRun(attachGuiMcp: boolean): boolean {
  return sandboxEnabled() && sandboxPlatformSupported() && attachGuiMcp && dockerAvailable() && sandboxImageExists();
}

// Spawn a terminal, wrapping it in a persistent tmux session when tmux is available and
// `persistent` is set, so it survives the server dying. `tmux new-session -A` creates it
// (running file+args) or reattaches the surviving one. Returns whether tmux backs it.
export function ptySpawn(
  sessionId: string,
  file: string,
  args: string[],
  cwd: string,
  persistent: boolean,
  unset: readonly string[] = [],
): { term: IPty; tmux: boolean } {
  if (persistent && tmuxAvailable()) {
    // A pane inherits the tmux SERVER's environment, so stripping our own copy is not
    // enough — the server may already carry the name from an earlier session.
    if (unset.length > 0) tmuxScrubEnvNames(unset);
    return { term: spawnPty("tmux", tmuxNewSessionArgs(sessionId, file, args, cwd), cwd, unset), tmux: true };
  }
  return { term: spawnPty(file, args, cwd, unset), tmux: false };
}

// Spawn the single-view session inside a Docker container (the sandbox path). Exports the
// host's live Keychain credential so the containerized claude is authenticated — without
// it the container reads a stale/absent ~/.claude/.credentials.json and shows "Not logged in".
export function spawnSandboxEntry(sessionId: string, claudeArgs: string[], cwd: string, ws: WebSocket | null): PtyEntry {
  cleanupSandbox(sessionId); // clear any stale container/config/credential with this name
  const claudeConfig = writeSandboxClaudeConfig(sessionId, cwd);
  const credentials = writeSandboxCredentials(sessionId);
  if (credentials === null)
    console.warn("[sandbox] no Claude credential found in the macOS Keychain — the container may be unauthenticated. Run `claude` on the host to log in.");
  const term = spawnPty("docker", buildDockerRunArgs(sessionId, claudeArgs, cwd, claudeConfig, credentials), cwd);
  console.log(`[pty] spawned claude (pid=${term.pid} via docker sandbox) in ${cwd}`);
  return { term, ws, buffer: "", cwd, sandbox: true, active: false, agent: "claude" };
}
