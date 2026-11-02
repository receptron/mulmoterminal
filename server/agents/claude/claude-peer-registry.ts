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
/** The registry's own naming: one `<pid>.json` per process. Anything else in the folder — the
 *  `.key` files, a name somebody made up — is not an entry. */
const ENTRY_FILE = /^\d+\.json$/;
/** An entry is a few hundred bytes. A file past this is not one, and is not read. */
export const MAX_ENTRY_BYTES = 64 * 1024;
/** One file per running claude, so a folder holding more than this is not the registry it was;
 *  the rest are left unread. A bound on the work, not a selection: which ones are read past it
 *  is whatever order the folder lists them in. */
export const MAX_ENTRIES = 256;
/** How many names of the folder are looked at before the listing stops, entries or not: the
 *  registry keeps a key file beside each entry and little else, so a folder with more names than
 *  this is not one, and listing it to the end is work the route must not do. */
export const MAX_SCANNED = MAX_ENTRIES * 4;

export interface RegistryLimits {
  entries: number;
  scanned: number;
}
const REGISTRY_LIMITS: RegistryLimits = { entries: MAX_ENTRIES, scanned: MAX_SCANNED };
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

// `lstat`, not `stat`: a symlink named like an entry must not be followed to whatever it points at —
// a `.key` beside it, or any file at all — so only a regular file of an entry's size is opened.
async function readEntry(file: string): Promise<ClaudePeer | null> {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) return null;
    return parseClaudePeer(JSON.parse(await fs.readFile(file, "utf8")));
  } catch {
    return null; // half-written, or not one of Claude Code's
  }
}

// The folder is listed incrementally and the listing stops at the first bound it meets, so a
// folder that has gone strange costs the route a bounded number of names rather than all of them.
// Leaving the loop closes the handle: the iterator's return() does that.
async function entryNamesIn(dir: string, limits: RegistryLimits): Promise<string[]> {
  const names: string[] = [];
  let scanned = 0;
  try {
    for await (const dirent of await fs.opendir(dir)) {
      if (names.length >= limits.entries || scanned >= limits.scanned) break;
      scanned++;
      if (ENTRY_FILE.test(dirent.name)) names.push(dirent.name);
    }
  } catch {
    return names; // no registry, or one that stopped being readable partway
  }
  return names;
}

/** The live entries in one home's registry; none where there is no registry to read. The files
 *  are read one at a time: a few hundred bytes each, and the hot route this serves must not fan
 *  out into hundreds of concurrent reads when a folder has gone strange. */
export async function readPeersIn(home: string, alive: (pid: number) => boolean, limits: RegistryLimits = REGISTRY_LIMITS): Promise<ClaudePeer[]> {
  const dir = path.join(home, SESSIONS_DIR);
  const peers: ClaudePeer[] = [];
  for (const name of await entryNamesIn(dir, limits)) {
    const peer = await readEntry(path.join(dir, name));
    if (peer !== null && alive(peer.pid)) peers.push(peer);
  }
  return peers;
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
