// The permission rules that let the cell drafting a skill's tasks save them (#3507). Accepting its plan
// with auto mode sends every write outside the cell's folder to Claude Code's classifier, which may
// refuse the save; an allow rule is checked before the classifier, so naming the one folder the tasks
// go in makes the save certain without widening anything else.
//
// Anything that could make the rule cover more than that one folder yields no rule at all: the save
// then goes back to the classifier's usual check, which costs a prompt, never an entitlement.
import path from "node:path";

/** Claude Code matches rules against POSIX paths, a Windows drive as `/c/...`; `//` marks an absolute one. */
export function claudeRulePath(absolutePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return path.posix.normalize(absolutePath);
  const forward = absolutePath.replace(/\\/g, "/");
  const letter = /^[A-Za-z]:/.test(forward) ? forward.charAt(0).toLowerCase() : null;
  return path.posix.normalize(letter === null ? forward : `/${letter}/${forward.slice(2)}`);
}

// Glob syntax in a rule would match more than the literal folder; a comma would split `--allowedTools`'
// list, and a parenthesis end the rule early.
const UNSAFE_IN_RULE = /[*?[\]{},()]/;

/** Whether `dir` is a direct child of `root`, by name, after both are normalised. */
export function isDirectChild(root: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(root) || !paths.isAbsolute(dir)) return false;
  const relative = paths.relative(paths.normalize(root), paths.normalize(dir));
  return relative !== "" && relative !== ".." && !paths.isAbsolute(relative) && !relative.includes(paths.sep) && !relative.includes("/");
}

/** `Write` and `Edit` anywhere under `dir`, as `--allowedTools` entries — only when `dir` is one
 *  evaluation folder directly under `root` and its path carries nothing a rule could read as more. */
export function evalDirWriteRules(dir: string, root: string, platform: NodeJS.Platform = process.platform): string[] {
  if (!isDirectChild(root, dir, platform)) return [];
  const rulePath = claudeRulePath(dir, platform);
  // normalize leaves at most one trailing slash.
  const folder = rulePath.endsWith("/") ? rulePath.slice(0, -1) : rulePath;
  if (!folder.startsWith("/") || UNSAFE_IN_RULE.test(folder)) return [];
  return ["Write", "Edit"].map((tool) => `${tool}(/${folder}/**)`);
}
