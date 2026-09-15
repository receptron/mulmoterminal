// The low-level ways this server starts a terminal: a bare pty, a tmux-backed one that
// survives the server dying. Split from index.ts (#548) ahead of
// the spawn functions that build on them — these four depend only on infra, so they move
// without carrying any of index.ts's session state along.
import pty from "node-pty";
import type { IPty } from "node-pty";
import os from "node:os";
import path from "node:path";
import { inheritedPtyEnv } from "../infra/pty-env.js";
import { resolvePtyLaunchForEnv } from "../infra/resolve-bin.js";
import { binaryProblemMessage, diagnoseBinary, type BinaryDiagnosis } from "../infra/has-binary.js";
import { cwdProblemMessage, diagnoseSpawnCwd, type CwdDiagnosis } from "../infra/spawn-cwd.js";
import { withoutUnset } from "./provider-env.js";
import { PORT, SESSION_ID_RE } from "../config/env.js";
import { reservedWorktreeEnv } from "../config/worktree-env.js";
import { ownBindPort, tmuxAvailable, tmuxClientUnsetNames, tmuxHasSession, tmuxNewSessionArgs, tmuxScrubEnvNames } from "../infra/tmux.js";

const PTY_COLS = 120;
const PTY_ROWS = 30;

/** Where the tmux CLIENT process itself is started from. The home directory because it is the one
 *  place this app never deletes; see the tmux branch of `ptySpawn` for why that matters. */
export const TMUX_CLIENT_CWD = os.homedir();

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
// On macOS a UTF-8 LANG is supplied when the environment names no locale at all (#1634) —
// inside `withoutUnset`, so a caller asking for LANG to be gone still gets it gone.
export function ptyEnv(unset: readonly string[] = [], extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const inherited = inheritedPtyEnv(process.env, process.platform, path.delimiter);
  return { ...withoutUnset(inherited, unset), ...extra };
}

/** What a terminal opened in `cwd` is given on top of the inherited environment: the per-tree
 *  values this directory reserved (#1367), then whatever the spawner itself computed.
 *
 *  The caller's own values WIN. A session id or an MCP url is about this session and could not be
 *  reserved for a directory; a project that declares a variable of the same name is describing
 *  what its dev server needs, and cannot be allowed to redirect our bridge.
 *
 *  Reserved, never allocated — allocation is async and happens before the spawn (see
 *  config/worktree-env.ts for why a probe at this moment would move a running server's port). */
//  MULMOTERMINAL_PORT is first because it is the weakest: it is a fact about this server that
//  EVERY terminal needs, agent or not. `mulmoterminal room` is a plain CLI a user runs in a shell
//  cell and it has to reach THIS server rather than whatever holds 34567 — it used to find the
//  port through the raw `PORT` the launcher gave every PTY, which is the leak #1857 is about and
//  had to go. It belongs HERE rather than in ptyEnv: a tmux pane's environment comes from
//  `new-session -e`, which is built from this and not from ptyEnv, so a shell cell under tmux
//  would otherwise get nothing. guiMcpEnv sets the same name for agent spawns, same value.
//
//  Written out, never read back by server/config/env.ts — a `yarn dev` inside a cell would then
//  bind MulmoTerminal's own port. See config/port-from-argv.ts.
const spawnEnvFor = (cwd: string, requested: Readonly<Record<string, string>>): Record<string, string> => ({
  MULMOTERMINAL_PORT: String(PORT),
  ...reservedWorktreeEnv(cwd),
  ...requested,
});

// pty.spawn with the binary as a PARAMETER (never a string literal at the call site),
// so the tmux/shell/claude spawns aren't flagged as spawn-of-a-string-literal.
export function spawnPty(bin: string, args: string[], cwd: string, unset: readonly string[] = [], extra: Readonly<Record<string, string>> = {}): IPty {
  const env = ptyEnv(unset, spawnEnvFor(cwd, extra));
  // On Windows neither the name nor the arguments reach node-pty as they are: its PATH
  // lookup ignores executable extensions (so `claude` misses claude.exe, #794), and a batch
  // shim has to be run through cmd.exe (#798). See infra/resolve-bin.ts.
  const launch = resolvePtyLaunchForEnv(bin, args, env);
  return pty.spawn(launch.file, launch.args, { name: "xterm-256color", cols: PTY_COLS, rows: PTY_ROWS, cwd, env });
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
  // The id names everything the session leaves behind — the tmux session (`mt-<id>`), the settings
  // and seed files — so an unset one poisons a SHARED name: a live `mt-undefined` was found on a
  // machine (#1533), and every spawn with the same defect would have attached that same pane, each
  // cell showing whichever conversation got there first. Refused here, at the one choke point every
  // spawner passes, so the defect is a failed launch with a message instead of a silently shared
  // terminal. Probe ids pass: they are UUID-shaped by construction (agents/probe-session.ts).
  if (!SESSION_ID_RE.test(sessionId)) throw new Error(`refusing to spawn a pty for an invalid session id: ${JSON.stringify(sessionId)}`);
  const { unset = [], binEnvVar } = options;
  // Merged HERE and not only in spawnPty, because the tmux branch below does not hand `env` to
  // the spawn at all — a pane's environment comes from `new-session -e`, so a variable missing
  // from that list reaches the program only if the tmux SERVER happens to already carry it.
  const env = spawnEnvFor(cwd, options.env ?? {});
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
    // The tmux CLIENT runs from a directory that cannot be deleted — deliberately NOT the cell's.
    //
    // tmux 3.7 moves the SERVER's cwd to the client's on every `new-session` and never restores
    // it (measured), and `spawn_pane()` guards its chdir on `getcwd()`. So a client started inside
    // a worktree leaves the server sitting there; when THIS APP then removes that worktree, the
    // server's `getcwd()` fails and the guard skips the chdir entirely — every later pane ignores
    // `-c` and starts in the deleted directory. A program that calls `getcwd()` as it starts (the
    // claude binary does) dies immediately, so every new session on the host is broken until the
    // tmux server is killed, while existing ones carry on (#1725, tmux/tmux#5473).
    //
    // The pane is unaffected: `new-session -c <cwd>` is what places it, and that is still the
    // cell's directory. Starting the server from a safe place is NOT a substitute — the first
    // `new-session` moves it again. tmux 3.6 and earlier do not have this behaviour.
    //
    // `tmuxClientUnsetNames` is added to `unset` for the client alone: when no server is running
    // this client CREATES one, and the new server keeps whatever environment it was started with for
    // its whole life — so our own bind port would reach every pane it ever opens (#1919). A PORT that
    // is NOT ours (`PORT=3000 mulmoterminal --port 34601`) is the user's and still travels (#1873).
    return {
      term: spawnPty("tmux", tmuxNewSessionArgs(sessionId, file, args, cwd, env), TMUX_CLIENT_CWD, [
        ...unset,
        ...tmuxClientUnsetNames(process.env.PORT, ownBindPort()),
      ]),
      tmux: true,
      reattached,
    };
  }
  return { term: spawnPty(file, args, cwd, unset, env), tmux: false, reattached };
}
