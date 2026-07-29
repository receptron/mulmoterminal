// The low-level ways this server starts a terminal: a bare pty, a tmux-backed one that
// survives the server dying, and the Docker sandbox. Split from index.ts (#548) ahead of
// the spawn functions that build on them — these four depend only on infra, so they move
// without carrying any of index.ts's session state along.
import pty from "node-pty";
import type { IPty } from "node-pty";
import path from "node:path";
import type { WebSocket } from "ws";
import { sanitizePtyEnv } from "../infra/pty-env.js";
import { resolvePtyLaunchForEnv } from "../infra/resolve-bin.js";
import { binaryProblemMessage, diagnoseBinary, type BinaryDiagnosis } from "../infra/has-binary.js";
import { cwdProblemMessage, diagnoseSpawnCwd, type CwdDiagnosis } from "../infra/spawn-cwd.js";
import { ptyStartLine } from "./pty-exit-log.js";
import { withoutUnset } from "./provider-env.js";
import { tmuxAvailable, tmuxHasSession, tmuxNewSessionArgs, tmuxScrubEnvNames } from "../infra/tmux.js";
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

// The environment a PTY will run with. Its own function because "can this binary be launched"
// has to be answered against exactly this and not process.env — the PATH they disagree on is the
// whole point of the check below (#1063).
// The env is sanitized: package-manager launcher vars (yarn's PREFIX kills nvm
// in spawned shells — see infra/pty-env.ts) must not leak into PTYs.
// `unset` drops variables the session must NOT inherit — ANTHROPIC_API_KEY for a provider
// session, which would silently outrank its auth token (#579). It cannot be expressed in
// the settings `env` block, which can set a variable but not remove one.
// `extra` is set on the spawned process ON TOP of the sanitized inherited environment —
// per-session values the child needs and our own process cannot carry (a session id).
export function ptyEnv(unset: readonly string[] = [], extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { ...withoutUnset(sanitizePtyEnv(process.env, path.delimiter), unset), ...extra };
}

// pty.spawn with the binary as a PARAMETER (never a string literal at the call site),
// so the tmux/shell/claude spawns aren't flagged as spawn-of-a-string-literal.
export function spawnPty(bin: string, args: string[], cwd: string, unset: readonly string[] = [], extra: Readonly<Record<string, string>> = {}): IPty {
  const env = ptyEnv(unset, extra);
  // On Windows neither the name nor the arguments reach node-pty as they are: its PATH
  // lookup ignores executable extensions (so `claude` misses claude.exe, #794), and a batch
  // shim has to be run through cmd.exe (#798). See infra/resolve-bin.ts.
  const launch = resolvePtyLaunchForEnv(bin, args, env);
  return pty.spawn(launch.file, launch.args, { name: "xterm-256color", cols: PTY_COLS, rows: PTY_ROWS, cwd, env });
}

// Would this session run in the Docker sandbox? Single-view interactive only (the caller
// adds `ws !== null`). Shared by the spawn gate and the connection handler so the
// pre-spawn credential refresh fires exactly when a sandbox spawn will.
export function sandboxWouldRun(attachGuiMcp: boolean): boolean {
  return sandboxEnabled() && sandboxPlatformSupported() && attachGuiMcp && dockerAvailable() && sandboxImageExists();
}

/** How a spawn's environment differs from ours. One object so ptySpawn keeps a readable arity. */
export interface PtySpawnEnv {
  /** Variables the session must NOT inherit (a provider session's ANTHROPIC_API_KEY). */
  unset?: readonly string[];
  /** Per-session variables to set on top of the inherited environment. */
  env?: Readonly<Record<string, string>>;
  /** The env override that would point `file` somewhere runnable (CLAUDE_BIN / CODEX_BIN).
   *  Present means "this is a named CLI — check it before spawning, and name this in the
   *  message if it cannot run". Absent means the caller owns the failure. */
  binEnvVar?: string;
}

// Would ptySpawn ATTACH to a program that is already running, rather than start a new one?
// `new-session -A` hides the difference — it returns a terminal either way — so a caller that
// needs to know has to ask before calling.
//
// It matters to anything a caller does "because a new process is about to read the user's
// config": on the attach path nothing is re-read, because nothing is re-started. The surviving
// process is exactly the one that was there before, and it is past every decision it made at
// startup. Must stay in lockstep with the branch below.
export function ptyWouldReattach(sessionId: string, persistent: boolean): boolean {
  return persistent && tmuxAvailable() && tmuxHasSession(sessionId);
}

/** A spawn refused before it was attempted, because something about it is already known not to
 *  work. Its `message` is already written for the user — a caller shows it as-is rather than
 *  guessing, which is the whole point (#1063). One base class so a caller can ask that question
 *  once instead of listing every reason. */
export class SpawnRefusedError extends Error {}

/** The program cannot be run: absent from PATH, not executable, a path that names nothing. */
export class SpawnBinaryError extends SpawnRefusedError {
  constructor(
    message: string,
    readonly diagnosis: BinaryDiagnosis,
  ) {
    super(message);
    this.name = "SpawnBinaryError";
  }
}

/** The working directory cannot be entered: deleted, renamed, or a file. */
export class SpawnCwdError extends SpawnRefusedError {
  constructor(
    message: string,
    readonly diagnosis: CwdDiagnosis,
  ) {
    super(message);
    this.name = "SpawnCwdError";
  }
}

// Refuse a spawn we can already tell will not work, while we still know WHY.
//
// Nothing here is a new failure: `file` was equally unrunnable before, it just arrived as a
// child that exited 1 with no output — and under tmux even that was invisible, because the
// pane's error scrolls past and the alt-screen restore wipes it. What this adds is the reason,
// at the only moment it can still be read.
//
// Against the env the CHILD gets, never process.env: sanitizePtyEnv drops PATH entries, so the
// two disagree on precisely the setups where the answer matters.
function refuseUnlaunchable(file: string, binEnvVar: string, env: NodeJS.ProcessEnv): void {
  const diagnosis = diagnoseBinary(file, env);
  const problem = binaryProblemMessage(file, diagnosis, binEnvVar);
  if (!problem) return;
  // The browser gets a truncated PATH so the banner stays readable; the whole of it goes here,
  // which is what someone diagnosing "but it works in my terminal" actually needs to compare.
  if (diagnosis.kind === "missing") console.error(`[pty] ${file} not found. PATH searched: ${diagnosis.searched.join(path.delimiter)}`);
  throw new SpawnBinaryError(problem, diagnosis);
}

// The same treatment for the directory, and for the same reason (#1078): `chdir` runs in the
// child, so on macOS a directory that is gone is another silent exit 1.
//
// `reattached` decides between refusing and merely saying so. A NEW program cannot start in a
// directory that is not there, so refusing turns a blank pane into a sentence. An ATTACH runs no
// program at all, and shutting someone out of an agent that is still running because they moved
// the directory would be a worse bug than the one being reported — but the tmux client we spawn
// takes the same cwd, so if the attach then fails, this line is why.
function refuseUnusableCwd(cwd: string, reattached: boolean): void {
  const diagnosis = diagnoseSpawnCwd(cwd);
  const problem = cwdProblemMessage(cwd, diagnosis);
  if (!problem) return;
  if (reattached) return console.warn(`[pty] attaching in an unusable directory — ${problem}`);
  throw new SpawnCwdError(problem, diagnosis);
}

// Spawn a terminal, wrapping it in a persistent tmux session when tmux is available and
// `persistent` is set, so it survives the server dying. `tmux new-session -A` creates it
// (running file+args) or reattaches the surviving one.
//
// `reattached` is returned because the two cases are worth telling apart afterwards and nothing
// downstream can: `-A` hands back a terminal either way, and on the attach path the binary, the
// argv and the cwd were never used — so a session that works proves nothing about them (#1063).
// It is a REPORT, not a decision: the tmux session can still die between the question and the
// answer, and a rare mislabelled line is the acceptable cost of not asking tmux twice.
//
// `binEnvVar` names the override that would fix a bad `file` (CODEX_BIN); passing it opts this
// spawn into the pre-flight check. A caller that omits it — one whose `file` is a shell, or a
// user's own command line — keeps the old behaviour of letting the child report its own failure.
export function ptySpawn(
  sessionId: string,
  file: string,
  args: string[],
  cwd: string,
  persistent: boolean,
  options: PtySpawnEnv = {},
): { term: IPty; tmux: boolean; reattached: boolean } {
  const { unset = [], env = {}, binEnvVar } = options;
  // `new-session -A` ATTACHES a surviving session without running `file` at all, so a binary
  // that has gone missing since must not stand between the user and their running agent.
  const reattached = ptyWouldReattach(sessionId, persistent);
  if (binEnvVar && !reattached) refuseUnlaunchable(file, binEnvVar, ptyEnv(unset, env));
  refuseUnusableCwd(cwd, reattached);
  if (persistent && tmuxAvailable()) {
    // A pane inherits the tmux SERVER's environment, so stripping our own copy is not
    // enough — the server may already carry the name from an earlier session. For the same
    // reason `env` goes to `new-session -e` rather than onto the tmux CLIENT we spawn here.
    if (unset.length > 0) tmuxScrubEnvNames(unset);
    return { term: spawnPty("tmux", tmuxNewSessionArgs(sessionId, file, args, cwd, env), cwd, unset), tmux: true, reattached };
  }
  return { term: spawnPty(file, args, cwd, unset, env), tmux: false, reattached };
}

// Spawn the single-view session inside a Docker container (the sandbox path). Exports the
// host's live Keychain credential so the containerized claude is authenticated — without
// it the container reads a stale/absent ~/.claude/.credentials.json and shows "Not logged in".
export function spawnSandboxEntry(sessionId: string, claudeArgs: string[], cwd: string, ws: WebSocket | null, addDirs: string[] | null = null): PtyEntry {
  cleanupSandbox(sessionId); // clear any stale container/config/credential with this name
  const claudeConfig = writeSandboxClaudeConfig(sessionId, cwd);
  const credentials = writeSandboxCredentials(sessionId);
  if (credentials === null)
    console.warn("[sandbox] no Claude credential found in the macOS Keychain — the container may be unauthenticated. Run `claude` on the host to log in.");
  const term = spawnPty("docker", buildDockerRunArgs(sessionId, claudeArgs, cwd, claudeConfig, credentials, addDirs), cwd);
  console.log(ptyStartLine({ agent: "claude", pid: term.pid, cwd, tmux: false, reattached: false, sessionId, note: "docker sandbox" }));
  return { term, ws, buffer: "", cwd, sandbox: true, active: false, agent: "claude" };
}
