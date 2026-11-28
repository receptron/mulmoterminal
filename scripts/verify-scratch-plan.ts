// What the verify-mulmoterminal skill's helper may touch, decided from observations without touching
// anything. The helper starts a server on a scratch HOME and later stops it. The mistakes that matter
// are stopping the maintainer's own tmux server, which holds every cell they have open, and
// signalling a process that is not the one it started. So the socket is COMPUTED the way the server
// names it, and a process is signalled only when what the OS reports about it matches what was
// recorded the moment it was spawned.
import path from "node:path";
import { homeScopeSuffix } from "../server/config/home-scope.js";

export const SOCKET_BASE_NAME = "mulmoterminal";
export const SUPPORTED_PLATFORMS: readonly string[] = ["darwin", "linux"];

export interface ScratchPaths {
  scratchHome: string;
  accountHome: string;
  tmuxSocketDir: string;
}

/** What the OS reports about one process; `stdoutPath` is the file its fd 1 is open on, null when it is not a file or unreadable. */
export interface ProcessFacts {
  pid: number;
  pgid: number;
  startedAt: string;
  command: string;
  stdoutPath: string | null;
}

/** What a process must show to be this run's: stdout on the scratch HOME's log, and the launcher script and port it was started for. */
export interface ScratchIdentity {
  logPath: string;
  launcherScript: string;
  launcherTitle: string;
}

/** What `start` saw of the launcher right after spawning it. */
export interface LauncherRecord {
  pid: number;
  startedAt: string;
  command: string;
}

/** One entry of `<HOME>/.mulmoterminal/instances/`, which a server writes about itself. */
export interface InstanceEntry {
  pid: number;
  port: number | null;
}

export const isSupportedPlatform = (platform: string): boolean => SUPPORTED_PLATFORMS.includes(platform);

/** The tmux socket a server started with HOME=scratchHome creates, or null for the account's own home. */
export function scratchSocketPath({ scratchHome, accountHome, tmuxSocketDir }: ScratchPaths): string | null {
  const suffix = homeScopeSuffix(scratchHome, accountHome);
  if (suffix === "") return null;
  return path.posix.join(tmuxSocketDir, `${SOCKET_BASE_NAME}${suffix}`);
}

/** Where tmux keeps `-L` sockets when TMUX_TMPDIR is unset: `<real /tmp>/tmux-<uid>`. POSIX paths: tmux has no other kind. */
export const tmuxSocketDirFor = (realTmpDir: string, uid: number): string => path.posix.join(realTmpDir, `tmux-${uid}`);

export type Decision = { ok: true } | { ok: false; reason: string };

/** Whether `socketPath` is one this helper may kill: exactly the computed scratch socket, which is absolute. */
export function socketStopDecision(socketPath: string, paths: ScratchPaths): Decision {
  const expected = scratchSocketPath(paths);
  if (expected === null) return { ok: false, reason: "the scratch HOME is the account's own home; its tmux server is the live one" };
  if (path.normalize(socketPath) !== path.normalize(expected)) return { ok: false, reason: `${socketPath} is not this scratch HOME's socket (${expected})` };
  return { ok: true };
}

/** The launcher's argv as `start` spawns it; only this checkout's launcher on this port matches. */
export const launcherArgs = (checkout: string, port: number, workDir: string): string[] => [
  path.join(checkout, "bin", "mulmoterminal.js"),
  "--port",
  String(port),
  "--no-open",
  "--cwd",
  workDir,
];

/**
 * Whether the process now at `recorded.pid` is the launcher `start` spawned. The launcher renames
 * itself to `mulmoterminal :<port>` once running, so its command is either the one recorded or that
 * title. Neither binds it to THIS run — the live server's launcher carries the same kind of title —
 * so its stdout must be the scratch HOME's log, which `start` opened for it, and its start time the
 * one recorded. (Its HOME cannot be read instead: renaming the process overwrites the environment
 * `ps -E` shows on macOS.)
 */
export function launcherMatches(recorded: LauncherRecord, observed: ProcessFacts | null, identity: ScratchIdentity): boolean {
  if (observed === null || observed.pid !== recorded.pid || observed.stdoutPath !== identity.logPath) return false;
  if (observed.startedAt !== recorded.startedAt || !recorded.command.includes(identity.launcherScript)) return false;
  return observed.command === recorded.command || observed.command === identity.launcherTitle;
}

/** The scratch server's pid: an entry under the scratch HOME, on the recorded port, in the launcher's group, writing to the scratch log. */
export function scratchServerPid(
  entries: readonly InstanceEntry[],
  port: number,
  factsOf: (pid: number) => ProcessFacts | null,
  launcherPid: number,
  logPath: string,
): number | null {
  const match = entries.find((entry) => {
    const facts = entry.port === port ? factsOf(entry.pid) : null;
    return facts !== null && facts.pgid === launcherPid && facts.stdoutPath === logPath;
  });
  return match === undefined ? null : match.pid;
}

/** Which process group `stop` may signal: the launcher's, when either it or its server is positively identified. */
export function groupToSignal(launcherIdentified: boolean, serverPid: number | null, launcherPid: number): number | null {
  return launcherIdentified || serverPid !== null ? launcherPid : null;
}

/** tmux is stopped only once nothing answers on the port, so a server is never left without its sessions. */
export function tmuxCleanupDecision(serverAnswers: boolean): Decision {
  return serverAnswers ? { ok: false, reason: "the server still answers; its tmux is left running" } : { ok: true };
}

/** Whether the built client is older than the newest source it is built from. */
export function isClientBuildStale(distBuiltAtMs: number | null, newestSourceAtMs: number): boolean {
  return distBuiltAtMs === null || distBuiltAtMs < newestSourceAtMs;
}
