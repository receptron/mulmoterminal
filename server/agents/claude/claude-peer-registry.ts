// Claude Code's registry of the sessions running on this machine, read for the name each one
// answers to (#3237): `<claude home>/sessions/<pid>.json`, in every home a claude session may be
// on. The `.key` beside each entry is that session's messaging secret and is never opened.
import { promises as fs } from "node:fs";
import path from "node:path";
import { hasErrnoCode } from "../../errors.js";
import { agentHomeChoices } from "../../session/session-home.js";
import { tmuxSessionName } from "../../infra/process/tmux.js";
import { parseClaudePeer, peerNameFor, type ClaudePeer } from "./claude-peers.js";

const SESSIONS_DIR = "sessions";
/** How long one read answers for: the grid asks once per cell, and nine cells ask within a few
 *  milliseconds of each other on mount. */
export const PEERS_CACHE_MS = 2000;

/** Whether `pid` is running. An entry a crashed claude left behind would otherwise claim a cell;
 *  a process that refuses the signal is running all the same. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return hasErrnoCode(err) && err.code === "EPERM";
  }
}

async function readEntry(file: string): Promise<ClaudePeer | null> {
  try {
    return parseClaudePeer(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return null; // half-written, or not one of Claude Code's
  }
}

/** The live entries in one home's registry; none where there is no registry to read. */
export async function readPeersIn(home: string, alive: (pid: number) => boolean): Promise<ClaudePeer[]> {
  const dir = path.join(home, SESSIONS_DIR);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => readEntry(path.join(dir, name))));
  return entries.filter((peer): peer is ClaudePeer => peer !== null && alive(peer.pid));
}

let cached: { at: number; peers: Promise<ClaudePeer[]> } | null = null;

/** Every live claude peer on this machine: the default home's and each account's. */
export function readClaudePeers(alive: (pid: number) => boolean = isProcessAlive, now: number = Date.now()): Promise<ClaudePeer[]> {
  if (cached !== null && now - cached.at < PEERS_CACHE_MS) return cached.peers;
  const peers = Promise.all(agentHomeChoices("claude").map(({ home }) => readPeersIn(home, alive))).then((perHome) => perHome.flat());
  cached = { at: now, peers };
  return peers;
}

export function forgetClaudePeers(): void {
  cached = null;
}

/** What the other Claude Code sessions call MulmoTerminal's session `id`, or null when no running
 *  claude answers to it. */
export async function claudePeerName(id: string): Promise<string | null> {
  return peerNameFor(await readClaudePeers(), { sessionId: id, tmuxSession: tmuxSessionName(id) });
}
