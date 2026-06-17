// Fix node-pty spawn-helper permissions (the npm tarball ships it 644, but
// posix_spawnp needs it executable). node-pty may be hoisted to a top-level
// node_modules (consumer / npx install) or nested (this repo), so resolve its
// real location via Node's module resolution instead of a fixed relative path —
// the hardcoded "../node_modules/node-pty" only worked in the nested case and
// left the helper non-executable on installs where node-pty was hoisted.
import { chmodSync, existsSync, readdirSync } from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let prebuilds;
try {
  prebuilds = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
} catch {
  // node-pty isn't installed/resolvable yet — nothing to fix.
  process.exit(0);
}

if (existsSync(prebuilds)) {
  for (const arch of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, arch, "spawn-helper");
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      console.log(`Fixed permissions: ${helper}`);
    }
  }
}
