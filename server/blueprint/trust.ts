// Whether Claude Code will start in a directory without asking "Do you trust this folder?". A step's
// session runs unattended, so an unanswered trust prompt stalls it until it is reaped — and the
// executor must never answer that prompt itself: trusting a folder is the person's decision (the
// rate-limit probe refuses to press Enter on it for the same reason).
//
// Claude Code looks for trust from the directory upward — but inside a git repository only as far as
// the repository's root. Measured with claude 2.1.282: a new directory under a trusted parent starts
// at the input box; the same directory, once `git init` has run in it, asks again; a subdirectory of
// a trusted repository does not ask.
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { isRecord } from "../../common/isRecord.js";
import { claudeUserConfigFile } from "../session/project-dir.js";

const ancestorsOf = (dir: string): string[] => {
  const parent = path.dirname(dir);
  return parent === dir ? [dir] : [dir, ...ancestorsOf(parent)];
};

const accepted = (entry: unknown): boolean => isRecord(entry) && entry.hasTrustDialogAccepted === true;

/** The directories whose trust counts for `dir`: up to `gitRoot` when it is in a repository. */
export function trustCandidates(dir: string, gitRoot: string | null): string[] {
  const all = ancestorsOf(path.resolve(dir));
  if (!gitRoot) return all;
  const rootIndex = all.indexOf(path.resolve(gitRoot));
  // A root that is not above `dir` says nothing true about it; trust nothing rather than everything.
  return rootIndex < 0 ? [] : all.slice(0, rootIndex + 1);
}

/** Pure: `projects` is the `projects` map of Claude Code's config, as read. */
export function isTrustedByClaude(dir: string, projects: unknown, gitRoot: string | null = null): boolean {
  if (!isRecord(projects)) return false;
  return trustCandidates(dir, gitRoot).some((candidate) => accepted(projects[candidate]));
}

const hasGitEntry = (dir: string): Promise<boolean> =>
  access(path.join(dir, ".git")).then(
    () => true,
    () => false,
  );

/** The nearest directory at or above `dir` holding a `.git`, or null. */
export async function gitRootOf(dir: string): Promise<string | null> {
  const found = await Promise.all(ancestorsOf(path.resolve(dir)).map(async (candidate) => ((await hasGitEntry(candidate)) ? candidate : null)));
  return found.find((candidate) => candidate !== null) ?? null;
}

/** Reads Claude Code's config; a missing or unreadable file trusts nothing. */
export async function claudeTrusts(dir: string, configFile: string = claudeUserConfigFile()): Promise<boolean> {
  try {
    const config: unknown = JSON.parse(await readFile(configFile, "utf8"));
    return isRecord(config) && isTrustedByClaude(dir, config.projects, await gitRootOf(dir));
  } catch {
    return false;
  }
}
