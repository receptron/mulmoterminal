// What the verify-mulmoterminal skill's helper may touch, decided without touching anything. The
// helper starts a server on a scratch HOME and later stops it; the one mistake that matters is
// stopping the maintainer's own tmux server, which holds every cell they have open. So the socket
// to stop is COMPUTED from the scratch HOME exactly as the server names it, and anything else is
// refused rather than guessed at.
import path from "node:path";
import { homeScopeSuffix } from "../server/config/home-scope.js";

export const SOCKET_BASE_NAME = "mulmoterminal";

export interface ScratchPaths {
  scratchHome: string;
  accountHome: string;
  tmuxSocketDir: string;
}

/** The tmux socket a server started with HOME=scratchHome creates, or null for the account's own home. */
export function scratchSocketPath({ scratchHome, accountHome, tmuxSocketDir }: ScratchPaths): string | null {
  const suffix = homeScopeSuffix(scratchHome, accountHome);
  if (suffix === "") return null;
  return path.join(tmuxSocketDir, `${SOCKET_BASE_NAME}${suffix}`);
}

/** Where tmux keeps sockets for `-L`: `$TMUX_TMPDIR` (else /tmp) / `tmux-<uid>`. */
export function tmuxSocketDirFor(tmuxTmpDir: string | undefined, uid: number): string {
  const base = tmuxTmpDir !== undefined && tmuxTmpDir !== "" ? tmuxTmpDir : "/tmp";
  return path.join(base, `tmux-${uid}`);
}

export type StopDecision = { ok: true } | { ok: false; reason: string };

/** Whether `socketPath` is one this helper may kill: exactly the computed scratch socket, which is absolute. */
export function socketStopDecision(socketPath: string, paths: ScratchPaths): StopDecision {
  const expected = scratchSocketPath(paths);
  if (expected === null) return { ok: false, reason: "the scratch HOME is the account's own home; its tmux server is the live one" };
  if (path.normalize(socketPath) !== path.normalize(expected)) return { ok: false, reason: `${socketPath} is not this scratch HOME's socket (${expected})` };
  return { ok: true };
}

/** Whether the built client is older than the newest source it is built from. */
export function isClientBuildStale(distBuiltAtMs: number | null, newestSourceAtMs: number): boolean {
  return distBuiltAtMs === null || distBuiltAtMs < newestSourceAtMs;
}
