import { mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeTempDir } from "./tempDir.js";
import { resolveContained } from "../../server/files/pathContainment";

/** A project whose `docs` folder can be swapped for a link out after the containment check has
 *  answered (#3306): what a route does next must not reach the file outside. */
export const swappableProject = () => {
  const top = realpathSync(makeTempDir("mt-verified-"));
  const root = path.join(top, "root");
  const outside = path.join(top, "outside");
  mkdirSync(path.join(root, "docs"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "docs", "a.md"), "inside");
  const recheck = (rel: string) => () => resolveContained(root, rel, os.homedir());
  // `docs` leads out from here on; the inside folder is kept aside so a swap back can restore it.
  const swapOut = () => {
    renameSync(path.join(root, "docs"), path.join(root, "docs-aside"));
    symlinkSync(outside, path.join(root, "docs"));
  };
  const swapBack = () => {
    rmSync(path.join(root, "docs"));
    renameSync(path.join(root, "docs-aside"), path.join(root, "docs"));
  };
  return { root, outside, recheck, swapOut, swapBack, cleanup: () => rmSync(top, { recursive: true, force: true }) };
};
