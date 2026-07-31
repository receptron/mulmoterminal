// Removing something we are done with — a session's settings file, a stale skill tree.
//
// `rmSync(..., { force: true })` swallows "it was not there" and nothing else, which is fine
// until Windows: a file another process still holds open, or a directory something is
// walking, fails with EPERM/EBUSY/ENOTEMPTY instead. Every caller here is CLEANUP — the work
// it belongs to has already finished or already failed — so a throw from it can only turn a
// transient lock into a broken teardown: a reap that stops halfway, a boot that gives up
// seeding. POSIX never showed this because it lets you unlink an open file.
//
// Failing to delete is not silent by accident: `removeQuietly` reports whether it managed it,
// so a caller that cares can say so.
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnCaptureAsync } from "./spawnCapture.js";

/** Remove a file or tree; never throws. Returns false when it could not (a Windows lock),
 *  which is a fact a caller may want to log — not one that should end its own work. */
export function removeQuietly(target: string, remove: (t: string) => void = removeRecursively): boolean {
  try {
    remove(target);
    return true;
  } catch {
    return false;
  }
}

// `remove` is injected because the failure this exists for cannot be produced on POSIX: it
// needs another process holding the file, which is a Windows-only state. Driving the catch
// with a thrower is the only way to check it from here.
const removeRecursively = (target: string): void => rmSync(target, { recursive: true, force: true });

/**
 * Drop the directory the removed Docker sandbox used to write per-session credentials into.
 *
 * Those files are an EXPORT OF THE KEYCHAIN OAuth credential (mode 0600), and the only thing that
 * ever deleted them was the sandbox's own cleanup — which went with the feature. So anyone who ran
 * the sandbox, and whose server was killed or upgraded before a session ended, is left holding a
 * live credential in a directory nothing will ever touch again (Codex, PR #1195).
 *
 * Unconditional and idempotent rather than marker-guarded like the probe sweep: this directory is
 * ours alone and nothing writes it any more, so there is no case where a second run could remove
 * something a first run should have kept.
 */
export function removeLegacySandboxCredentials(home: string): boolean {
  const dir = path.join(home, "sandbox");
  // Reports whether it was THERE, not whether the removal succeeded (removeQuietly answers true
  // for a path that never existed). The caller uses that as the evidence that this machine ever
  // ran the sandbox — see removeLegacySandboxContainers.
  if (!existsSync(dir)) return false;
  // The FILES now; the directory itself only once the container sweep has answered. Splitting the
  // two is what makes the retry work: the credentials are the urgent half and go immediately, and
  // the empty directory is what remembers that a sweep is still owed. Removing both here made the
  // migration one-shot — a first boot with Docker not yet up would lose the sweep forever, and any
  // orphan container would outlive every later start (Codex, PR #1195).
  // readdirSync THROWS — EACCES on an unreadable directory, ENOTDIR if the path is a file, ENOENT
  // if it goes away between the check above and here. This function runs at boot with no caller
  // catching, so an escaping throw is a server that will not start, over litter from a feature
  // that no longer exists — exactly the trade this whole file exists to refuse (Codex, PR #1195).
  //
  // Still `true` when it fails: the directory is there, which is the only question the caller is
  // asking. Nothing is lost by trying again — the sweep leaves the directory alone unless docker
  // answers, and an unreadable one resists removal anyway, so the next boot retries both halves.
  try {
    for (const entry of readdirSync(dir)) removeQuietly(path.join(dir, entry));
  } catch {
    // unreadable or gone — the retry above is the answer
  }
  return true;
}

/** The migration is finished: no credentials, and the containers have been answered for. */
function forgetLegacySandboxDir(home: string): void {
  removeQuietly(path.join(home, "sandbox"));
}

/**
 * Force-remove containers the sandbox left running.
 *
 * `docker run --rm` cleans up when the CONTAINER exits, not when its client dies — killing the
 * client only detaches, which is why reap() force-removed the container explicitly. That call went
 * with the feature, so a server killed or upgraded mid-session leaves a container running with the
 * workspace and ~/.claude still mounted read-write, and nothing left in the app can reach it
 * (Codex, PR #1195).
 *
 * Best-effort and silent: Docker may be absent, stopped, or slow, and none of that is a reason to
 * hold up a boot. ASYNC and BOUNDED for that reason, not as a style choice — a wedged daemon makes
 * `docker ps` hang, and the synchronous form has no timeout, so this would have blocked startup on
 * exactly the machines it exists to help (Codex, PR #1195). The caller does not await it.
 *
 * Guarded by the CALLER on the legacy directory existing, so a machine that never ran the sandbox
 * never invokes docker at all — which is nearly every machine, since it was opt-in and macOS-only.
 */
export async function removeLegacySandboxContainers(home: string): Promise<void> {
  const listed = await spawnCaptureAsync("docker", ["ps", "-aq", "--filter", "name=^mulmoterminal-"], { timeoutMs: DOCKER_SWEEP_TIMEOUT_MS });
  // Docker absent, not up yet, or too slow to answer: leave the directory so the next boot asks
  // again. Only a real answer retires the migration.
  if (listed.status !== 0) return;
  const ids = listed.stdout.split("\n").filter((id) => /^[0-9a-f]{6,}$/i.test(id.trim()));
  if (ids.length > 0) {
    const removed = await spawnCaptureAsync("docker", ["rm", "-f", ...ids], { timeoutMs: DOCKER_SWEEP_TIMEOUT_MS });
    if (removed.status !== 0) return; // still owed — try again next boot
    console.log(`[cleanup] removed ${ids.length} leftover sandbox container(s)`);
  }
  forgetLegacySandboxDir(home);
}

// Shorter than spawnCapture's default: nothing waits on this, and a container left behind by a
// feature that no longer exists is not worth minutes of a daemon that is not answering.
const DOCKER_SWEEP_TIMEOUT_MS = 5_000;
