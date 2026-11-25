// The permission rules that let the cell drafting a skill's tasks save them (#3507). Accepting its plan
// with auto mode sends every write outside the cell's folder to Claude Code's classifier, which may
// refuse the save; an allow rule is checked before the classifier, so naming the one folder the tasks
// go in makes the save certain without widening anything else.
import path from "node:path";

/** Claude Code matches rules against POSIX paths, a Windows drive as `/c/...`; `//` marks an absolute one. */
export function claudeRulePath(absolutePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return path.posix.normalize(absolutePath);
  const forward = absolutePath.replace(/\\/g, "/");
  const letter = /^[A-Za-z]:/.test(forward) ? forward.charAt(0).toLowerCase() : null;
  return path.posix.normalize(letter === null ? forward : `/${letter}/${forward.slice(2)}`);
}

/** `Write` and `Edit` anywhere under `dir`, as `--allowedTools` entries. None when the path could not
 *  survive that flag's comma-separated list, which only costs the classifier's usual check. */
export function evalDirWriteRules(dir: string, platform: NodeJS.Platform = process.platform): string[] {
  const rulePath = claudeRulePath(dir, platform);
  // normalize leaves at most one trailing slash.
  const folder = rulePath.endsWith("/") ? rulePath.slice(0, -1) : rulePath;
  // A folder that normalises to the root, or to a whole Windows drive, would allow every write on it.
  const isRoot = folder === "" || (platform === "win32" && /^\/[a-z]$/.test(folder));
  if (!rulePath.startsWith("/") || isRoot || /[,()]/.test(folder)) return [];
  return ["Write", "Edit"].map((tool) => `${tool}(/${folder}/**)`);
}
