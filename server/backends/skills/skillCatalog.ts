// The Skills viewer's disk side (#2815): scan the user skills dir, the enabled user plugins, and every
// directory a terminal has run in, and read one SKILL.md back for the preview.
//
// "What counts as a skill" is `collectSkills`, the rule the header's Skill menu already uses.
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collectSkills } from "../remoteHost/skills.js";
import { userPluginInstalls, type PluginInstall } from "../remoteHost/pluginSkills.js";
import { projectSkillsDir, userSkillsDir } from "../collections/collections.js";
import { SLUG_RE } from "../../agents/codex/codex-skills.js";
import { assembleSkillCatalog, recentDistinctDirs, type FoundPlugin, type FoundSource, type SkillCatalog } from "../../../common/skillCatalog.js";

/** A SKILL.md is a page of instructions; anything past this is not one, and is not read whole. */
export const MAX_SKILL_DOC_BYTES = 1024 * 1024;
const SKILL_FILE = "SKILL.md";

export interface SkillCatalogOptions {
  /** Directories terminals have run in, oldest first, repeats allowed. */
  cwds: readonly string[];
  /** Override `~/.claude/skills/`, for tests. */
  userDir?: string;
}

/** The project directories worth scanning: each once, newest first, minus one whose skills dir IS
 *  the user dir (a terminal opened in `$HOME`), which would list the user skills a second time. */
function projectDirs(cwds: readonly string[], userDir: string): string[] {
  const userRoot = resolve(userDir);
  return recentDistinctDirs(cwds).filter((dir) => resolve(projectSkillsDir(dir)) !== userRoot);
}

const pluginSkillsDir = (install: PluginInstall): string => join(install.installPath, "skills");

async function readPlugins(userDir: string): Promise<FoundPlugin[]> {
  const installs = await userPluginInstalls(userDir);
  return Promise.all(
    installs.map(async (install) => ({ plugin: install.plugin, dir: install.installPath, skills: await collectSkills(pluginSkillsDir(install)) })),
  );
}

async function readProjects(dirs: readonly string[]): Promise<FoundSource[]> {
  return Promise.all(dirs.map(async (dir) => ({ dir, skills: await collectSkills(projectSkillsDir(dir)) })));
}

export async function readSkillCatalog(opts: SkillCatalogOptions): Promise<SkillCatalog> {
  const userDir = opts.userDir ?? userSkillsDir();
  const [userSkills, plugins, projects] = await Promise.all([collectSkills(userDir), readPlugins(userDir), readProjects(projectDirs(opts.cwds, userDir))]);
  return assembleSkillCatalog({ dir: userDir, skills: userSkills }, plugins, projects);
}

/** Where the skill lives: the user dir, an enabled user plugin by name, or a remembered directory. */
export type SkillDocSource = { scope: "user" } | { scope: "plugin"; plugin: string } | { scope: "project"; dir: string };

export interface SkillDocRequest extends SkillCatalogOptions {
  source: SkillDocSource;
  slug: string;
}

/** The skills root a request may read from, or null when it names a plugin that is not enabled or a
 *  directory no terminal ran in. */
async function allowedRoot(request: SkillDocRequest): Promise<string | null> {
  const userDir = request.userDir ?? userSkillsDir();
  const { source } = request;
  if (source.scope === "user") return userDir;
  if (source.scope === "project") return request.cwds.includes(source.dir) ? projectSkillsDir(source.dir) : null;
  const install = (await userPluginInstalls(userDir)).find((candidate) => candidate.plugin === source.plugin);
  return install ? pluginSkillsDir(install) : null;
}

/** Where a request's SKILL.md is, or null when the request is not allowed. */
export async function skillDocFile(request: SkillDocRequest): Promise<string | null> {
  const root = await allowedRoot(request);
  return root === null || !SLUG_RE.test(request.slug) ? null : join(root, request.slug, SKILL_FILE);
}

/** The SKILL.md text, or null when the request is not allowed, the file is missing, or too large. */
export async function readSkillDoc(request: SkillDocRequest): Promise<string | null> {
  const file = await skillDocFile(request);
  if (file === null) return null;
  try {
    if ((await stat(file)).size > MAX_SKILL_DOC_BYTES) return null;
    return await readFile(file, "utf-8");
  } catch {
    return null;
  }
}
