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
import { rmSync } from "node:fs";
import path from "node:path";

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
export function removeLegacySandboxDir(home: string): boolean {
  return removeQuietly(path.join(home, "sandbox"));
}
