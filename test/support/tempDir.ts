import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A temp directory spelled the way the production code will resolve it.
//
// Two platforms rewrite the path `mkdtemp` hands back, and a fixture that skips this compares a
// path the code under test never produces:
//
//   macOS   /var/... -> /private/var/...        (the temp dir is itself behind a symlink)
//   Windows C:\Users\RUNNER~1\... -> ...\runneradmin\...   (an 8.3 short component)
//
// `.native` matters on Windows: Node's JS realpathSync leaves the 8.3 component alone while the
// native call expands it, so only the native one agrees with what the server resolves
// (server/git/worktrees.ts says the same, and #1052 is the CI failure that proved it).
export function makeTempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(path.join(tmpdir(), prefix)));
}
