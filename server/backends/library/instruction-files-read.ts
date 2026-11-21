// Reading the instruction files Claude Code loads for one directory (#3332): which of the candidates
// exist, their size, the rules in each `.claude/rules` folder, and the files their `@path` imports bring
// in. Read only; the order and the rules of loading are instruction-files.ts.
import { promises as fs } from "node:fs";
import path from "node:path";
import { INSTRUCTION_FILE_MAX_BYTES, type LibraryInstructionFile, type LibraryInstructions } from "../../../common/libraryTools.js";
import { LIBRARY_FILE_TEXT_MAX, type LibraryFileText } from "../../../common/libraryFiles.js";
import {
  agentsCandidates,
  countsAsClaudeMd,
  importsOf,
  IMPORT_DEPTH_MAX,
  isPathScopedRule,
  launchCandidates,
  type InstructionCandidate,
} from "./instruction-files.js";

/** Rules read from one folder at most: a folder of thousands is not instructions anyone wrote. */
export const RULES_PER_FOLDER_MAX = 200;

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

/** The `.md` files under a rules folder, in path order, at most the cap. */
async function ruleFiles(folder: string): Promise<string[]> {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, RULES_PER_FOLDER_MAX);
}

interface Walk {
  home: string;
  seen: Set<string>;
  out: LibraryInstructionFile[];
}

/** One file and, after it, what its imports bring in — depth-first, as they are expanded in place. */
async function addFile(
  walk: Walk,
  candidate: InstructionCandidate,
  loads: LibraryInstructionFile["loads"],
  importedBy: string | null,
  depth: number,
): Promise<boolean> {
  if (walk.seen.has(candidate.path)) return false;
  const read = await readInstruction(candidate.path);
  if (read === null) return false;
  walk.seen.add(candidate.path);
  walk.out.push({ ...read.file, scope: candidate.scope, loads, importedBy });
  if (read.text === null || depth >= IMPORT_DEPTH_MAX) return true;
  for (const imported of importsOf(read.text, candidate.path, walk.home)) {
    await addFile(walk, { scope: "import", path: imported }, loads, candidate.path, depth + 1);
  }
  return true;
}

async function addRules(walk: Walk, candidate: InstructionCandidate): Promise<void> {
  for (const file of await ruleFiles(candidate.path)) {
    const text = (await readInstruction(file))?.text ?? "";
    await addFile(walk, { scope: candidate.scope, path: file }, isPathScopedRule(text) ? "on-demand" : "launch", null, 0);
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
  const walk: Walk = { home, seen: new Set(), out: [] };
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
  return { cwd, files: walk.out, agentsMd };
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
