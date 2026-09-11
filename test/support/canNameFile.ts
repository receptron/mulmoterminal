import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Whether this filesystem accepts a given filename. Windows refuses `< > : " / \ | ? *` outright,
// so a fixture built from one throws in `beforeAll` and takes the WHOLE spec file down — which
// reads as the feature being broken rather than as the fixture being unbuildable (#2040 cost two
// Windows CI rounds this way: first the symlink, then the quote).
//
// Probed rather than checked against `process.platform`, for `canSymlink`'s reason: the question is
// what the filesystem under the runner will accept, and a platform check answers a different one.
export function canNameFile(name: string): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-name-probe-"));
  try {
    writeFileSync(path.join(dir, name), "");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
