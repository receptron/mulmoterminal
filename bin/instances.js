// Which MulmoTerminal servers are running right now (#1061).
//
// Two things need this answer and neither could get it before. The launcher asks so it can say
// "one is already running" no matter which port the new one was told to use — the port probe only
// notices a clash on the SAME port, so `--port <free>` started a second instance in silence. And
// the server asks before deleting orphaned session settings: without tmux, "nothing survived the
// last lifetime" is only true for the process that OWNED that lifetime, so a second instance was
// reading a peer's live files as leftovers and removing them.
//
// Shared as plain JS rather than through common/ because the launcher runs on bare node before
// any TypeScript exists — the same reason bin/update-check.js is shaped this way, and the server
// imports it the same way.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { portOwners } from "./port-owner.js";

export const instancesDir = () => path.join(homedir(), ".mulmoterminal", "instances");

const entryFile = (pid) => path.join(instancesDir(), `${pid}.json`);

/** Whether a pid belongs to a process that still exists. Signal 0 performs the permission and
 *  existence checks without delivering anything; EPERM means it IS there, just not ours. */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/** Announce this process, and hand back the removal. Best-effort throughout: not being able to
 *  say hello is not a reason to fail a boot, and a crash simply leaves an entry whose pid no
 *  longer resolves — which every reader already has to handle. */
export function registerInstance(port, pid = process.pid, startedAt = Date.now()) {
  const file = entryFile(pid);
  try {
    mkdirSync(instancesDir(), { recursive: true, mode: 0o700 });
    // Written elsewhere and renamed into place: a reader that catches us mid-write would see a
    // truncated entry, and "I could not parse it" must never be how a LIVE peer disappears from
    // the registry (Codex review). rename is atomic for a reader on the same directory.
    const tmp = `${file}.${startedAt}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid, port, startedAt }), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    return () => {};
  }
  return () => {
    try {
      rmSync(file, { force: true });
    } catch {
      // Left behind; the next reader drops it as stale.
    }
  };
}

const parseEntry = (raw) => {
  try {
    const entry = JSON.parse(raw);
    if (!entry || typeof entry !== "object") return null;
    const { pid, port, startedAt } = entry;
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, port: Number.isInteger(port) ? port : null, startedAt: Number.isFinite(startedAt) ? startedAt : null };
  } catch {
    return null;
  }
};

/** Drop an entry we have positively established nobody is behind. Takes a path, and each caller
 *  passes the file it actually read: liveInstances its own, servingInstances `<pid>.json` — which is
 *  the same file only because liveInstances refuses to report one whose name disagrees with its
 *  pid. Best-effort: one we may not remove is one the next reader disproves again. */
const forgetFile = (file) => {
  try {
    rmSync(file, { force: true });
  } catch {
    // not ours to remove; harmless
  }
};

/** Every OTHER running server, newest entry first. Entries whose process is gone are deleted as
 *  they are found: a crash cannot clean up after itself, and leaving them would make a lone
 *  instance believe it has company forever. */
export function liveInstances(excludePid = process.pid) {
  let names;
  try {
    names = readdirSync(instancesDir());
  } catch {
    return []; // never registered on this machine
  }
  const live = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(instancesDir(), name);
    let entry;
    try {
      entry = parseEntry(readFileSync(file, "utf8"));
    } catch {
      continue; // being written right now, or unreadable — say nothing about it
    }
    // Only a positively-identified dead owner earns removal. An entry we could not parse is one
    // we know nothing about — deleting it on that basis is how a live peer gets erased, which is
    // the very failure this registry exists to prevent (Codex review).
    if (entry === null) continue;
    if (!isProcessAlive(entry.pid)) {
      forgetFile(file);
      continue;
    }
    // Every writer names the file after the pid inside it, so a file that disagrees was not written
    // by one — corrupted, or edited by hand. Report nothing about it: a reader that acts on an
    // entry by its pid (servingInstances deletes `<pid>.json`, stop signals the pid) would act on
    // SOMEBODY ELSE's file or process, and a live server's own entry is the one it would erase.
    if (name !== `${entry.pid}.json`) continue;
    if (entry.pid !== excludePid) live.push(entry);
  }
  return live.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/**
 * Of these entries, the ones whose pid STILL OWNS the port it registered — and the others deleted.
 *
 * A LIVE PID IS NOT AN IDENTITY, and `liveInstances` above cannot tell the difference. The OS
 * hands a pid out again once its process is gone, so an entry left by a hard kill becomes a peer
 * that never dies: the reporter's machine had one whose number `svchost.exe` and later
 * `csrss.exe` were holding, and every start after that was told one was already running (#2090).
 *
 * bin/port-owner.js had already written down why the kernel is the only party worth asking, and
 * bin/stop.js has been asking since #1820 — for signalling, where the same staleness would kill a
 * stranger. What made this reader wait was that its question looked harmless.
 *
 * THERE IS NO BOOT RACE HERE. `registerInstance` is called from inside the server's `listen`
 * callback, so the port is already bound the moment the entry exists: an entry whose port has no
 * owner cannot be a peer that has not finished starting.
 *
 * NULL KEEPS THE ENTRY, which is the OPPOSITE of stop.js and deliberate. `portOwners` answers null
 * for "could not ask" and [] for "nobody is there", and what the two risks cost is not the same:
 * stopping the wrong process is worse than asking, so `stop` fails closed; losing the
 * second-instance warning is worse than keeping a stale line, so this fails open. Do not unify
 * them.
 */
export async function servingInstances(instances, deps = {}) {
  const { owners = portOwners } = deps;
  const serving = [];
  for (const instance of instances) {
    // Nothing to ask about: an entry with no port names no socket to check it against.
    const pids = instance.port === null ? null : await owners(instance.port);
    if (pids === null || pids.includes(instance.pid)) serving.push(instance);
    else forgetFile(entryFile(instance.pid));
  }
  return serving;
}

/** When the EARLIEST of the given instances started, or null when there are none.
 *
 *  This is the cutoff the settings prune needs: a file written before every live peer began
 *  cannot belong to one of them, so it is safe to treat as a leftover. A file written after that
 *  moment might be a peer's, and a maybe is not good enough to delete somebody's live state. */
export function earliestStartedAt(instances) {
  const times = instances.map((i) => i.startedAt).filter((t) => typeof t === "number");
  return times.length ? Math.min(...times) : null;
}
