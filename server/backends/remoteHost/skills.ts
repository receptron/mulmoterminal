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
import { SLUG_RE } from "../../codex-skills.js";

const SKILL_FILE = "SKILL.md";

/** A discovered skill: its id (directory name) and the one-line description from
 *  its SKILL.md frontmatter (used as the header menu's tooltip). */
export interface DiscoveredSkill {
  slug: string;
  description: string;
}

// A directory counts as a skill only when it holds a SKILL.md whose YAML
// frontmatter declares a `description`. This matches MulmoClaude's
// `parseSkillFrontmatter`, which returns null (→ the dir is skipped) without a
// closing fence or a description key — so both hosts advertise the same ids.
// Returns the description value (used for the menu tooltip), or null to skip.
//
// Scanned line-by-line rather than with a whole-document regex: a lazy
// `[\s\S]*?` up to a closing fence backtracks super-linearly on a SKILL.md with
// many newlines and no closing `---` (ReDoS). The line walk is linear.
const parseSkillDescription = (raw: string): string | null => {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return null; // must open with a fence on line 1
  const close = lines.indexOf("---", 1); // …and be terminated
  if (close === -1) return null;
  for (const line of lines.slice(1, close)) {
    // Split on the first colon (no regex — a `\s*key\s*:\s*(.*)$` pattern backtracks
    // super-linearly). Key must be exactly `description` after trimming.
    const trimmed = line.trimStart();
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    if (trimmed.slice(0, colon).trimEnd() !== "description") continue;
    return unquote(trimmed.slice(colon + 1).trim());
  }
  return null;
};

// Strip one layer of matching surrounding quotes from a YAML scalar so the tooltip
// reads cleanly (`description: "foo"` → `foo`). Not a full YAML parser — enough for
// the common quoted-string case.
const unquote = (value: string): string => {
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
};

// Read `dir/SKILL.md` and return its description, or null when the dir isn't a
// skill. Any read error (missing file, permissions) means "not a skill".
const readSkillDescription = async (dir: string): Promise<string | null> => {
  try {
    return parseSkillDescription(await readFile(join(dir, SKILL_FILE), "utf-8"));
  } catch {
    return null;
  }
};

// Scan one skills root for valid skills (name + description). A missing root is
// the common case (a workspace with no `.claude/skills/`) → empty list.
const collectSkills = async (root: string): Promise<DiscoveredSkill[]> => {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const skills: DiscoveredSkill[] = [];
  for (const name of entries) {
    // Only accept safe slugs. This drops hidden entries (.DS_Store, .gitkeep) AND
    // names with whitespace/quotes/newlines — a malformed slug reaches the client as
    // /<slug> typed into the session, so validate at the discovery source (menu + API
    // + the .mulmoterminal.json allowlist all read from here).
    if (!SLUG_RE.test(name)) continue;
    const dir = resolve(root, name);
    try {
      // stat (not lstat) follows symlinks, so `ln -s target skills/name` works.
      if (!(await stat(dir)).isDirectory()) continue;
    } catch {
      continue;
    }
    const description = await readSkillDescription(dir);
    if (description !== null) skills.push({ slug: name, description });
  }
  return skills;
};

export interface DiscoverSkillNamesOptions {
  /** Workspace root; project skills live at `<workspaceRoot>/.claude/skills/`. */
  workspaceRoot: string;
  /** Override `~/.claude/skills/` — for tests that point at a tmp tree so they
   *  don't leak the developer's real skills into assertions. */
  userDir?: string;
}

const bySlugAsc = (left: DiscoveredSkill, right: DiscoveredSkill): number => left.slug.localeCompare(right.slug);

/**
 * Every skill available to this workspace (name + description). **Project-scope
 * (working-dir) skills lead the list**, then user-scope ones, alphabetical within
 * each group. A project skill also shadows a user skill of the same slug (its
 * description wins). Map insertion order gives the project-first ordering.
 */
export const discoverSkills = async (opts: DiscoverSkillNamesOptions): Promise<DiscoveredSkill[]> => {
  const [userSkills, projectSkills] = await Promise.all([collectSkills(opts.userDir ?? userSkillsDir()), collectSkills(projectSkillsDir(opts.workspaceRoot))]);
  const bySlug = new Map<string, DiscoveredSkill>();
  for (const skill of [...projectSkills].sort(bySlugAsc)) bySlug.set(skill.slug, skill); // project first + shadows user
  for (const skill of [...userSkills].sort(bySlugAsc)) if (!bySlug.has(skill.slug)) bySlug.set(skill.slug, skill);
  return [...bySlug.values()];
};

/**
 * Every skill id available to this workspace, deduped and **sorted alphabetically**
 * (the ordering the remote-host `listSkills` capability advertises — independent of
 * the menu's project-first display order).
 */
export const discoverSkillNames = async (opts: DiscoverSkillNamesOptions): Promise<string[]> =>
  (await discoverSkills(opts)).map((skill) => skill.slug).sort((left, right) => left.localeCompare(right));

/**
 * Apply a per-dir Skill-menu allowlist (`.mulmoterminal.json` `skills`): keep only
 * the listed slugs, **in the filter's order** (a listed slug that isn't discovered
 * is dropped). A null filter means "no filtering" — return the skills unchanged.
 */
export const applySkillFilter = (skills: DiscoveredSkill[], filter: string[] | null): DiscoveredSkill[] => {
  if (!filter) return skills;
  const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
  return filter.map((slug) => bySlug.get(slug)).filter((skill): skill is DiscoveredSkill => skill !== undefined);
};
