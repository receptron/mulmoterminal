// Skill discovery for the remote-host `listSkills` capability.
//
// MulmoTerminal drives `claude` over the same workspace, so the same skills the
// CLI discovers under `~/.claude/skills/` and `<workspace>/.claude/skills/` are
// available here. This mirrors MulmoClaude's `listSkills`: it returns the ids
// (directory names) of discoverable skills as a flat `string[]` — read-only, and
// the collection slugs are subtracted by the handler (a skill dir that also ships
// a `schema.json` is a collection, served by `listCollections`, so it must not
// double-list).
//
// The roots come from backends/collections.ts (`userSkillsDir` / `projectSkillsDir`),
// the SAME directories the collection engine discovers — so the skill/collection
// split is derived from one source of truth, not two.
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { userSkillsDir, projectSkillsDir } from "../collections.js";

const SKILL_FILE = "SKILL.md";

// A directory counts as a skill only when it holds a SKILL.md whose YAML
// frontmatter declares a `description`. This matches MulmoClaude's
// `parseSkillFrontmatter`, which returns null (→ the dir is skipped) without a
// closing fence or a description key — so both hosts advertise the same ids.
//
// Scanned line-by-line rather than with a whole-document regex: a lazy
// `[\s\S]*?` up to a closing fence backtracks super-linearly on a SKILL.md with
// many newlines and no closing `---` (ReDoS). The line walk is linear.
const isSkillMarkdown = (raw: string): boolean => {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return false; // must open with a fence on line 1
  const close = lines.indexOf("---", 1); // …and be terminated
  if (close === -1) return false;
  return lines.slice(1, close).some((line) => /^\s*description\s*:/.test(line));
};

// True when `dir/SKILL.md` exists and carries usable frontmatter. Any read error
// (missing file, permissions) means "not a skill" rather than a thrown list.
const hasSkillMarkdown = async (dir: string): Promise<boolean> => {
  try {
    return isSkillMarkdown(await readFile(join(dir, SKILL_FILE), "utf-8"));
  } catch {
    return false;
  }
};

// Scan one skills root for valid-skill directory names. A missing root is the
// common case (a workspace with no `.claude/skills/`) → empty list.
const collectSkillNames = async (root: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue; // .DS_Store, .gitkeep, …
    const dir = resolve(root, name);
    try {
      // stat (not lstat) follows symlinks, so `ln -s target skills/name` works.
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    if (await hasSkillMarkdown(dir)) names.push(name);
  }
  return names;
};

export interface DiscoverSkillNamesOptions {
  /** Workspace root; project skills live at `<workspaceRoot>/.claude/skills/`. */
  workspaceRoot: string;
  /** Override `~/.claude/skills/` — for tests that point at a tmp tree so they
   *  don't leak the developer's real skills into assertions. */
  userDir?: string;
}

/**
 * Every skill id available to this workspace, deduped and sorted. Project-scope
 * skills shadow user-scope ones of the same name (only the id survives the merge,
 * so a Set dedup is exact).
 */
export const discoverSkillNames = async (opts: DiscoverSkillNamesOptions): Promise<string[]> => {
  const [userNames, projectNames] = await Promise.all([
    collectSkillNames(opts.userDir ?? userSkillsDir()),
    collectSkillNames(projectSkillsDir(opts.workspaceRoot)),
  ]);
  return [...new Set([...userNames, ...projectNames])].sort((left, right) => left.localeCompare(right));
};
