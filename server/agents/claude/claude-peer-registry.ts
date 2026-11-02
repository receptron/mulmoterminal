// Claude Code's registry of the sessions running on this machine, read for the name each one
// answers to (#3237): `<claude home>/sessions/<pid>.json`, in every home a claude session may be
// on. The `.key` beside each entry is that session's messaging secret and is never opened.
import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { hasErrnoCode } from "../../errors.js";
import { agentHomeChoices } from "../../session/session-home.js";
import { tmuxSessionName } from "../../infra/process/tmux.js";
import { parseClaudePeer, parsePsStartTimes, peerNameFor, withVerifiedStarts, type ClaudePeer } from "./claude-peers.js";

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

// The one way bytes enter from the folder: a descriptor opened WITHOUT following links, checked
// to be a regular file of an entry's size through that same descriptor, and read through it for at
// most MAX_ENTRY_BYTES. So a symlink named like an entry is refused by the open itself (ELOOP),
// not by a check a moment earlier that a swapped link could outrun. Windows has no O_NOFOLLOW; there
// the link check is the `lstat` before the open, a step apart, which is the platform's best.
const NO_FOLLOW: number | undefined = constants.O_NOFOLLOW;

async function openEntry(file: string): Promise<FileHandle> {
  if (NO_FOLLOW === undefined && !(await fs.lstat(file)).isFile()) throw new Error(`${file} is not a regular file`);
  return fs.open(file, constants.O_RDONLY | (NO_FOLLOW ?? 0));
}

async function readEntry(file: string): Promise<ClaudePeer | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await openEntry(file);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_ENTRY_BYTES) return null;
    const bytes = Buffer.alloc(MAX_ENTRY_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, MAX_ENTRY_BYTES, 0);
    return parseClaudePeer(JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")));
  } catch {
    return null; // a link, half-written, or not one of Claude Code's
  } finally {
    await handle?.close();
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

/** How long `ps` may take before its answer is treated as unavailable. */
const PS_TIMEOUT_MS = 3000;
/** By its fixed path, not through PATH: macOS, glibc and busybox systems all keep it here, and a
 *  box that does not answers nothing, which is the "cannot be asked" case below. */
const PS = "/bin/ps";

/** When each of `pids` started, by the OS's account: one `ps` for all of them, read whatever its
 *  exit code (a pid gone meanwhile makes it non-zero while the others still print). Null where the
 *  OS cannot be asked — Windows has no `ps`, and a box without one answers nothing. */
export function processStartTimes(pids: readonly number[]): Promise<Map<number, number> | null> {
  if (process.platform === "win32" || pids.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const ps = spawn(PS, ["-o", "pid=,lstart=", "-p", pids.join(",")], { stdio: ["ignore", "pipe", "ignore"], timeout: PS_TIMEOUT_MS });
    ps.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ps.on("error", () => resolve(null));
    ps.on("close", (code, signal) => {
      const stdout = Buffer.concat(chunks).toString("utf8");
      // Killed by the timeout, or failed with nothing to show (a `ps` that does not know `lstart`,
      // every asked pid gone meanwhile): the OS could not be asked. A non-zero exit WITH output is a
      // pid or two gone meanwhile, and the rest were answered.
      resolve(signal !== null || (code !== 0 && stdout.trim() === "") ? null : parsePsStartTimes(stdout));
    });
  });
}

export type StartTimes = (pids: readonly number[]) => Promise<Map<number, number> | null>;

let cached: { at: number; peers: Promise<ClaudePeer[]> } | null = null;

/** Every live claude peer on this machine: the default home's and each account's, each one's
 *  process checked against its entry where the OS can say when it started. */
export function readClaudePeers(
  alive: (pid: number) => boolean = isProcessAlive,
  now: number = Date.now(),
  starts: StartTimes = processStartTimes,
): Promise<ClaudePeer[]> {
  if (cached !== null && now - cached.at < PEERS_CACHE_MS) return cached.peers;
  const peers = Promise.all(agentHomeChoices("claude").map(({ home }) => readPeersIn(home, alive)))
    .then((perHome) => perHome.flat())
    .then(async (live) => withVerifiedStarts(live, await starts(live.map((peer) => peer.pid))));
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
