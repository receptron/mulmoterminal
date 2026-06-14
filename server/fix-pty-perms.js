// Fix node-pty spawn-helper permissions (macOS npm tarball ships 644)
import { chmodSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = path.resolve(__dirname, "../node_modules/node-pty/prebuilds");

for (const arch of ["darwin-arm64", "darwin-x64"]) {
  const helper = path.join(base, arch, "spawn-helper");
  if (existsSync(helper)) {
    chmodSync(helper, 0o755);
    console.log(`Fixed permissions: ${helper}`);
  }
}
