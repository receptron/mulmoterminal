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
