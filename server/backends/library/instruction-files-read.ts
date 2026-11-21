// Reading the instruction files Claude Code loads for one directory (#3332): which of the candidates
// exist, their size, the rules in each `.claude/rules` folder, and the files their `@path` imports bring
// in. Read only; the order and the rules of loading are instruction-files.ts.
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { INSTRUCTION_FILE_MAX_BYTES, type LibraryInstructionFile, type LibraryInstructions } from "../../../common/libraryTools.js";
import { LIBRARY_FILE_TEXT_MAX, type LibraryFileText } from "../../../common/libraryFiles.js";
import {
  agentsCandidates,
  countsAsClaudeMd,
  importsOf,
  IMPORT_DEPTH_MAX,
  isInside,
  isNetworkPath,
  isPathScopedRule,
  launchCandidates,
  type InstructionCandidate,
} from "./instruction-files.js";

/** Rules read from one folder at most: a folder of thousands is not instructions anyone wrote. */
export const RULES_PER_FOLDER_MAX = 200;
/** Entries looked at under one rules folder at most, however deep: the walk stops there. */
export const RULE_ENTRIES_MAX = 2000;
/** Files listed in all, and imports followed from one file: a file of thousands of `@path` lines is
 *  not read through to the end. */
export const INSTRUCTION_FILES_MAX = 300;
export const IMPORTS_PER_FILE_MAX = 100;

interface Read {
  file: Omit<LibraryInstructionFile, "scope" | "loads" | "importedBy">;
  text: string | null;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** A regular file's size and text, or null when there is none. Over the size Claude Code reads, it is
 *  listed as skipped and its text is not read. */
async function readInstruction(file: string): Promise<Read | null> {
  const info = await fs.stat(file).catch(() => null);
  if (info === null || !info.isFile()) return null;
  if (info.size > INSTRUCTION_FILE_MAX_BYTES) return { file: { path: file, lines: 0, bytes: info.size, state: "too-large" }, text: null };
  const text = await fs.readFile(file, "utf8").catch(() => null);
  if (text === null) return { file: { path: file, lines: 0, bytes: info.size, state: "unreadable" }, text: null };
  return { file: { path: file, lines: lineCount(text), bytes: Buffer.byteLength(text), state: "ok" }, text };
}

interface RuleFile {
  path: string;
  /** Reached through a link whose target is outside `within`: read only once that is approved. */
  external: boolean;
}

/** Where a link points, when it is one: its own text, resolved, without looking the target up (a
 *  network target would be contacted). */
async function linkTarget(file: string): Promise<string | null> {
  const target = await fs.readlink(file).catch(() => null);
  return target === null ? null : path.resolve(path.dirname(file), target);
}

/** One entry of a rules folder: a folder to walk, a rule, or nothing (anything else, or a link to a
 *  network path). Through a link, whether its target leaves `within`. */
async function ruleEntry(dir: RuleFile, entry: Dirent, within: string | null): Promise<{ kind: "folder" | "rule"; rule: RuleFile } | null> {
  const full = path.join(dir.path, entry.name);
  const target = entry.isSymbolicLink() ? await linkTarget(full) : null;
  if (target !== null && isNetworkPath(target)) return null;
  const info = target === null ? entry : await fs.stat(full).catch(() => null);
  const realTarget = target === null ? null : await fs.realpath(full).catch(() => null);
  const external = dir.external || (within !== null && realTarget !== null && !isInside(within, realTarget));
  if (info?.isDirectory()) return { kind: "folder", rule: { path: full, external } };
  return info?.isFile() && entry.name.endsWith(".md") ? { kind: "rule", rule: { path: full, external } } : null;
}

/** The `.md` files under a rules folder, in path order, at most the cap. Links are followed, as Claude
 *  Code follows a shared rules folder linked in — never to a network path — and each real folder is
 *  walked once, so a loop ends. `within` is the directory a link must stay in not to need approval. */
async function ruleFiles(folder: string, within: string | null): Promise<RuleFile[]> {
  const found: RuleFile[] = [];
  const queue: RuleFile[] = [{ path: folder, external: false }];
  const walked = new Set<string>();
  let budget = RULE_ENTRIES_MAX;
  while (queue.length > 0 && budget > 0) {
    const dir = queue.shift() ?? { path: "", external: false };
    const real = await fs.realpath(dir.path).catch(() => null);
    if (real === null || walked.has(real)) continue;
    walked.add(real);
    const entries = (await fs.readdir(dir.path, { withFileTypes: true }).catch(() => [])).slice(0, budget);
    budget -= entries.length;
    for (const entry of entries) {
      const seen = await ruleEntry(dir, entry, within);
      if (seen?.kind === "folder") queue.push(seen.rule);
      else if (seen?.kind === "rule") found.push(seen.rule);
    }
  }
  return found.toSorted((a, b) => a.path.localeCompare(b.path)).slice(0, RULES_PER_FOLDER_MAX);
}

interface Walk {
  home: string;
  seen: Set<string>;
  out: LibraryInstructionFile[];
  /** Files looked for, found or not: the bound on one listing's work. */
  looked: number;
  /** The working directory, as given and as resolved: what an import must stay in not to need approval. */
  cwd: string[];
}

/** One file and, after it, what its imports bring in — depth-first, as they are expanded in place. */
async function addFile(
  walk: Walk,
  candidate: InstructionCandidate,
  loads: LibraryInstructionFile["loads"],
  importedBy: string | null,
  depth: number,
): Promise<boolean> {
  if (walk.seen.has(candidate.path) || walk.looked >= INSTRUCTION_FILES_MAX) return false;
  walk.looked += 1;
  const read = await readInstruction(candidate.path);
  if (read === null) return false;
  walk.seen.add(candidate.path);
  walk.out.push({ ...read.file, scope: candidate.scope, loads, importedBy });
  if (read.text === null || depth >= IMPORT_DEPTH_MAX) return true;
  const fromInside = walk.cwd.some((dir) => isInside(dir, candidate.path));
  for (const imported of importsOf(read.text, candidate.path, walk.home).slice(0, IMPORTS_PER_FILE_MAX)) {
    if (isNetworkPath(imported)) continue;
    // A file in the project importing one outside it: Claude Code asks before loading that.
    const external = fromInside && !walk.cwd.some((dir) => isInside(dir, imported));
    await addFile(walk, { scope: "import", path: imported }, external ? "approval" : loads, candidate.path, depth + 1);
  }
  return true;
}

const ruleLoads = (external: boolean, scoped: boolean): LibraryInstructionFile["loads"] => {
  if (external) return "approval";
  return scoped ? "on-demand" : "launch";
};

/** The user's rules need no approval; a project rule linked in from outside it does, and then only one
 *  without `paths` loads at all. */
async function addRules(walk: Walk, candidate: InstructionCandidate): Promise<void> {
  const within = candidate.scope === "rule" ? (walk.cwd.at(-1) ?? null) : null;
  for (const file of await ruleFiles(candidate.path, within)) {
    const scoped = isPathScopedRule((await readInstruction(file.path))?.text ?? "");
    if (file.external && scoped) continue;
    await addFile(walk, { scope: candidate.scope, path: file.path }, ruleLoads(file.external, scoped), null, 0);
  }
}

/** Every instruction file Claude Code loads in `cwd`, in its order, with Claude Code's default choice
 *  between CLAUDE.md and AGENTS.md. */
export async function readInstructions(
  cwd: string,
  configDir: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): Promise<LibraryInstructions> {
  const real = await fs.realpath(cwd).catch(() => cwd);
  const walk: Walk = { home, seen: new Set(), out: [], looked: 0, cwd: [cwd, real] };
  const candidates = launchCandidates(cwd, configDir, platform);
  const claudeMd = await Promise.all(candidates.filter(countsAsClaudeMd).map((candidate) => readInstruction(candidate.path)));
  const agentsMd = claudeMd.every((read) => read === null);
  for (const candidate of candidates) {
    if (candidate.scope === "user-rule" || candidate.scope === "rule") await addRules(walk, candidate);
    else if (!(agentsMd && countsAsClaudeMd(candidate))) await addFile(walk, candidate, "launch", null, 0);
    // AGENTS.md takes the place of the directories' CLAUDE.md files, read where they would have been.
    if (agentsMd && candidate.scope === "user-rule") {
      for (const agents of agentsCandidates(cwd, platform)) await addFile(walk, agents, "launch", null, 0);
    }
  }
  return { cwd, files: walk.out, agentsMd, truncated: walk.looked >= INSTRUCTION_FILES_MAX };
}

/** One instruction file's text to show. Through a link, on purpose: Claude Code follows one (a CLAUDE.md
 *  linked to AGENTS.md, a shared rules folder), so the file shown is the file it reads. */
export async function readInstructionText(file: string): Promise<LibraryFileText> {
  const info = await fs.stat(file).catch(() => null);
  if (info === null) return { text: null, reason: "absent" };
  if (!info.isFile()) return { text: null, reason: "unreadable" };
  if (info.size > LIBRARY_FILE_TEXT_MAX) return { text: null, reason: "too-large" };
  const bytes = await fs.readFile(file).catch(() => null);
  if (bytes === null) return { text: null, reason: "unreadable" };
  if (bytes.length > LIBRARY_FILE_TEXT_MAX) return { text: null, reason: "too-large" };
  return bytes.includes(0) ? { text: null, reason: "binary" } : { text: bytes.toString("utf8") };
}
