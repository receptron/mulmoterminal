// Reading the instruction files Claude Code loads for one directory (#3332): which of the candidates
// exist, their size, the rules in each `.claude/rules` folder, and the files their `@path` imports bring
// in. Read only; the order and the rules of loading are instruction-files.ts.
//
// Every path goes through `localTarget` before anything looks it up: Claude Code never follows a link
// to a network path (looking one up can contact the host), so neither does this — and the real path
// that comes back is what a file is known by, what "outside the directory" is judged on, and what is read.
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
/** Links followed in a chain at most, as the system's own limit does. */
const LINK_HOPS_MAX = 40;

/** The real, local path a path leads to, or null: missing, a loop, or a link — at any hop — to a network
 *  path, which is never looked up. Each hop's target is read from the link itself before the next lookup. */
export async function localTarget(file: string): Promise<string | null> {
  let at = file;
  for (let hop = 0; hop < LINK_HOPS_MAX; hop += 1) {
    if (isNetworkPath(at)) return null;
    const info = await fs.lstat(at).catch(() => null);
    if (info === null) return null;
    if (!info.isSymbolicLink()) {
      const real = await fs.realpath(at).catch(() => null);
      return real === null || isNetworkPath(real) ? null : real;
    }
    const target = await fs.readlink(at).catch(() => null);
    if (target === null) return null;
    at = path.resolve(path.dirname(at), target);
  }
  return null;
}

interface Read {
  file: Omit<LibraryInstructionFile, "scope" | "loads" | "importedBy">;
  text: string | null;
  /** The file it really is. */
  real: string;
}

function lineCount(text: string): number {
  if (text === "") return 0;
  const breaks = text.split("\n").length - 1;
  return text.endsWith("\n") ? breaks : breaks + 1;
}

/** A regular file's size and text, or null when there is none. Over the size Claude Code reads, it is
 *  listed as skipped and its text is not read. Listed by the path it was reached by. */
async function readInstruction(file: string): Promise<Read | null> {
  const real = await localTarget(file);
  const info = real === null ? null : await fs.stat(real).catch(() => null);
  if (real === null || info === null || !info.isFile()) return null;
  if (info.size > INSTRUCTION_FILE_MAX_BYTES) return { file: { path: file, lines: 0, bytes: info.size, state: "too-large" }, text: null, real };
  const text = await fs.readFile(real, "utf8").catch(() => null);
  if (text === null) return { file: { path: file, lines: 0, bytes: info.size, state: "unreadable" }, text: null, real };
  return { file: { path: file, lines: lineCount(text), bytes: Buffer.byteLength(text), state: "ok" }, text, real };
}

interface RuleFile {
  path: string;
  /** Really outside the directory rules must stay in: read only once that is approved. */
  external: boolean;
}

/** At most `count` entries of a folder, read one at a time: a folder of millions is never listed whole. */
async function firstEntries(folder: string, count: number): Promise<Dirent[]> {
  const opened = await fs.opendir(folder).catch(() => null);
  if (opened === null) return [];
  const entries: Dirent[] = [];
  try {
    for await (const entry of opened) {
      entries.push(entry);
      if (entries.length >= count) break;
    }
  } catch {
    // An entry that cannot be read ends the listing where it stands.
  }
  return entries;
}

/** One entry of a rules folder: a folder to walk, a rule, or nothing. Outside `within`, by where it
 *  really is, it needs approval. */
async function ruleEntry(full: string, within: string[] | null): Promise<{ kind: "folder" | "rule"; rule: RuleFile; real: string } | null> {
  const real = await localTarget(full);
  const info = real === null ? null : await fs.stat(real).catch(() => null);
  if (real === null || info === null) return null;
  const rule = { path: full, external: within !== null && !within.some((dir) => isInside(dir, real)) };
  if (info.isDirectory()) return { kind: "folder", rule, real };
  return info.isFile() && full.endsWith(".md") ? { kind: "rule", rule, real } : null;
}

/** The `.md` files under a rules folder (itself perhaps a link), in path order, at most the cap; `capped`
 *  when there were more. Each real folder is walked once, so a loop ends. `within` is the directory
 *  rules must really be in not to need approval — null for the user's, which never do. */
async function ruleFiles(folder: string, within: string[] | null): Promise<{ rules: RuleFile[]; capped: boolean }> {
  const root = await ruleEntry(folder, within);
  if (root?.kind !== "folder") return { rules: [], capped: false };
  const found: RuleFile[] = [];
  const queue = [root];
  const walked = new Set<string>();
  let budget = RULE_ENTRIES_MAX;
  while (queue.length > 0 && budget > 0) {
    const dir = queue.shift() ?? root;
    if (walked.has(dir.real)) continue;
    walked.add(dir.real);
    const entries = await firstEntries(dir.rule.path, budget);
    budget -= entries.length;
    for (const entry of entries) {
      const seen = await ruleEntry(path.join(dir.rule.path, entry.name), within);
      // Inside a folder already outside, everything is.
      if (seen !== null && dir.rule.external) seen.rule.external = true;
      if (seen?.kind === "folder") queue.push(seen);
      else if (seen?.kind === "rule") found.push(seen.rule);
    }
  }
  const sorted = found.toSorted((a, b) => a.path.localeCompare(b.path));
  return { rules: sorted.slice(0, RULES_PER_FOLDER_MAX), capped: sorted.length > RULES_PER_FOLDER_MAX || budget <= 0 };
}

interface Walk {
  home: string;
  /** Files listed, by what they really are: an alias of one already listed is the same file. */
  seen: Set<string>;
  out: LibraryInstructionFile[];
  /** Files looked for, found or not: the bound on one listing's work. */
  looked: number;
  truncated: boolean;
  /** The working directory, as given and as resolved: what an import must really stay in not to need approval. */
  cwd: string[];
}

const insideCwd = (walk: Walk, target: string): boolean => walk.cwd.some((dir) => isInside(dir, target));

/** One file and, after it, what its imports bring in — depth-first, as they are expanded in place. */
async function addFile(
  walk: Walk,
  candidate: InstructionCandidate,
  loads: LibraryInstructionFile["loads"],
  importedBy: string | null,
  depth: number,
): Promise<void> {
  if (walk.looked >= INSTRUCTION_FILES_MAX) {
    walk.truncated = true;
    return;
  }
  walk.looked += 1;
  const read = await readInstruction(candidate.path);
  if (read === null || walk.seen.has(read.real)) return;
  walk.seen.add(read.real);
  walk.out.push({ ...read.file, scope: candidate.scope, loads, importedBy });
  if (read.text === null || depth >= IMPORT_DEPTH_MAX) return;
  const fromInside = insideCwd(walk, read.real);
  for (const imported of importsOf(read.text, candidate.path, walk.home).slice(0, IMPORTS_PER_FILE_MAX)) {
    const landed = await localTarget(imported);
    if (landed === null) continue;
    // A file in the project importing one really outside it: loaded only once that is approved.
    const external = fromInside && !insideCwd(walk, landed);
    await addFile(walk, { scope: "import", path: imported }, external ? "approval" : loads, candidate.path, depth + 1);
  }
}

const ruleLoads = (external: boolean, scoped: boolean): LibraryInstructionFile["loads"] => {
  if (external) return "approval";
  return scoped ? "on-demand" : "launch";
};

/** The user's rules need no approval; a project rule really outside it does, and then only one
 *  without `paths` loads at all. */
async function addRules(walk: Walk, candidate: InstructionCandidate): Promise<void> {
  const { rules, capped } = await ruleFiles(candidate.path, candidate.scope === "rule" ? walk.cwd : null);
  if (capped) walk.truncated = true;
  for (const file of rules) {
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
  // A directory that is not a local one (gone, or leading to a network path) has nothing under it to look
  // up: every lookup below it would go through that link.
  const real = await localTarget(cwd);
  if (real === null) return { cwd, files: [], agentsMd: false, truncated: false };
  const walk: Walk = { home, seen: new Set(), out: [], looked: 0, truncated: false, cwd: [cwd, real] };
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
  return { cwd, files: walk.out, agentsMd, truncated: walk.truncated };
}

/** One instruction file's text to show: what it really is, through links — never to a network path —
 *  as Claude Code reads it. */
export async function readInstructionText(file: string): Promise<LibraryFileText> {
  const real = await localTarget(file);
  const info = real === null ? null : await fs.stat(real).catch(() => null);
  if (real === null || info === null) return { text: null, reason: "absent" };
  if (!info.isFile()) return { text: null, reason: "unreadable" };
  if (info.size > LIBRARY_FILE_TEXT_MAX) return { text: null, reason: "too-large" };
  const bytes = await fs.readFile(real).catch(() => null);
  if (bytes === null) return { text: null, reason: "unreadable" };
  if (bytes.length > LIBRARY_FILE_TEXT_MAX) return { text: null, reason: "too-large" };
  return bytes.includes(0) ? { text: null, reason: "binary" } : { text: bytes.toString("utf8") };
}
