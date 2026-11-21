// Which instruction files Claude Code loads for one working directory (#3332), as its documentation
// states them (code.claude.com/docs/en/memory): the managed file, the user's, then every directory from
// the filesystem root down to the working directory, each read in that order. Pure: paths in, paths out;
// the reader asks the disk which exist.
import path from "node:path";
import { splitCode } from "./memory-health.js";
import { trimEndOf } from "../../../common/trimEndOf.js";
import type { LibraryInstructionScope } from "../../../common/libraryTools.js";

export type InstructionScope = LibraryInstructionScope;

export interface InstructionCandidate {
  scope: InstructionScope;
  path: string;
}

/** Where an organization's managed CLAUDE.md is, by system. */
export function managedInstructionFile(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/CLAUDE.md";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\CLAUDE.md";
  return "/etc/claude-code/CLAUDE.md";
}

/** The working directory and every directory above it, the filesystem root first. */
export function directoriesDown(cwd: string, flavour: Pick<typeof path, "dirname"> = path): string[] {
  const up: string[] = [cwd];
  for (let at = cwd; flavour.dirname(at) !== at; at = flavour.dirname(at)) up.push(flavour.dirname(at));
  return up.reverse();
}

/** The files read at launch, in the order Claude Code reads them. `.claude/rules` folders are listed by
 *  the reader, so they appear here as their folder. Within each directory `CLAUDE.local.md` comes last. */
export function launchCandidates(cwd: string, configDir: string, platform: NodeJS.Platform): InstructionCandidate[] {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  const directories = directoriesDown(cwd, flavour).flatMap((dir): InstructionCandidate[] => {
    const own = dir === cwd ? [{ scope: "project" as const, path: flavour.join(dir, ".claude", "CLAUDE.md") }] : [];
    return [{ scope: "directory", path: flavour.join(dir, "CLAUDE.md") }, ...own, { scope: "local", path: flavour.join(dir, "CLAUDE.local.md") }];
  });
  return [
    { scope: "managed", path: managedInstructionFile(platform) },
    { scope: "user", path: flavour.join(configDir, "CLAUDE.md") },
    { scope: "user-rule", path: flavour.join(configDir, "rules") },
    ...directories,
    { scope: "rule", path: flavour.join(cwd, ".claude", "rules") },
  ];
}

/** `AGENTS.md` is read in place of CLAUDE.md only when none of these is in the working directory or
 *  above it (the user's and the managed one do not count). */
export const countsAsClaudeMd = (candidate: InstructionCandidate): boolean =>
  candidate.scope === "directory" || candidate.scope === "project" || candidate.scope === "local";

/** The AGENTS.md files read when no CLAUDE.md counts: in the working directory and above it. */
export function agentsCandidates(cwd: string, platform: NodeJS.Platform): InstructionCandidate[] {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  return directoriesDown(cwd, flavour).flatMap((dir): InstructionCandidate[] => [
    { scope: "agents", path: flavour.join(dir, "AGENTS.md") },
    { scope: "agents", path: flavour.join(dir, ".claude", "AGENTS.md") },
  ]);
}

/** A path as written in a sentence ends before the punctuation closing that sentence: `@README.md.` */
const CLOSING = new Set([".", ",", ";", ":", ")", "]"]);
const withoutClosingPunctuation = (raw: string): string => trimEndOf(raw, CLOSING);

/** A network path, which Claude Code never follows a link or an import to: looking one up can contact
 *  the host it names (`\\server\share`, `/net/…`, `/Network/…`). */
export function isNetworkPath(target: string): boolean {
  // A share named by two separators of either kind — `\\server\share` or `//server/share` — but not
  // `\\wsl$`, which is this machine's Linux, nor `///x`, which is just a local path.
  if (/^[\\/]{2}(?![\\/])/.test(target)) return !/^[\\/]{2}wsl\$/i.test(target);
  return /^\/(?:net|Network)(?:\/|$)/.test(target);
}

/** Whether `target` is `dir` or under it, by either separator. */
export const isInside = (dir: string, target: string): boolean => target === dir || target.startsWith(`${dir}/`) || target.startsWith(`${dir}\\`);

/** Imports go at most this many hops from the file that loads at launch. */
export const IMPORT_DEPTH_MAX = 4;

/** The `@path` imports in an instruction file's text, outside code spans and blocks: a backslash keeps
 *  a space in the path, and a quoted path is not an import — `@"path"` nor `"@path"` (asked of Claude
 *  Code itself: it loads neither). Resolved against the file's own folder,
 *  `~/` against the home. An `@` inside a word (an address) is not one. At most `limit`, distinct, in
 *  the order written: reading stops there, however many more the file holds. */
export function importsOf(
  text: string,
  fromFile: string,
  home: string,
  flavour: Pick<typeof path, "dirname" | "resolve" | "join" | "isAbsolute"> = path,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  const paths = new Set<string>();
  for (const match of splitCode(text).prose.matchAll(/(?<![\w@"'])@((?:\\.|[^\s"'`\\])+)/g)) {
    if (paths.size >= limit) break;
    const raw = withoutClosingPunctuation((match[1] ?? "").replace(/\\ /g, " "));
    if (raw !== "") paths.add(raw.startsWith("~/") ? flavour.join(home, raw.slice(2)) : flavour.resolve(flavour.dirname(fromFile), raw));
  }
  return [...paths];
}

/** Whether a rule file loads only for matching files: it has a `paths` field in its frontmatter. */
export function isPathScopedRule(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return false;
  const end = lines.slice(1).findIndex((line) => line.trim() === "---");
  return end >= 0 && lines.slice(1, end + 1).some((line) => /^paths\s*:/.test(line));
}
