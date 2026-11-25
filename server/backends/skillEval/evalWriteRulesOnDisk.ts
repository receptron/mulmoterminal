// The drafting cell's write rules for its save folder (#3507), checked against the disk: the rule itself
// is evalWriteRules.ts's, and this only decides which spelling of the folder it names.
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { evalDirWriteRules, isDirectChild } from "./evalWriteRules.js";

/** None when the folder is a link to somewhere else. When the root sits behind a link, the folder is
 *  named both ways, since either may be the spelling Claude Code compares. The root is made first, so
 *  a first evaluation is not the one left without. */
export async function authorWriteRules(evalDir: string, root: string): Promise<string[]> {
  if (!isDirectChild(root, evalDir)) return [];
  await mkdir(root, { recursive: true }).catch(() => undefined);
  const realRoot = await realpath(root).catch(() => null);
  if (realRoot === null) return [];
  const canonical = path.join(realRoot, path.basename(evalDir));
  const realDir = await realpath(evalDir).catch(() => null);
  if (realDir !== null && realDir !== canonical) return [];
  return [...new Set([...evalDirWriteRules(evalDir, root), ...evalDirWriteRules(canonical, realRoot)])];
}
