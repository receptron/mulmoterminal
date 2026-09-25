// Whether Claude Code will start in a directory without asking "Do you trust this folder?". A step's
// session runs unattended, so an unanswered trust prompt stalls it until it is reaped — and the
// executor must never answer that prompt itself: trusting a folder is the person's decision (the
// rate-limit probe refuses to press Enter on it for the same reason).
//
// Claude Code accepts trust from the directory OR any ancestor. Measured with claude 2.1.282: a new
// directory under a trusted parent started straight at the input box.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { isRecord } from "../../common/isRecord.js";
import { claudeUserConfigFile } from "../session/project-dir.js";

const ancestorsOf = (dir: string): string[] => {
  const parent = path.dirname(dir);
  return parent === dir ? [dir] : [dir, ...ancestorsOf(parent)];
};

const accepted = (entry: unknown): boolean => isRecord(entry) && entry.hasTrustDialogAccepted === true;

/** Pure: `projects` is the `projects` map of Claude Code's config, as read. */
export function isTrustedByClaude(dir: string, projects: unknown): boolean {
  if (!isRecord(projects)) return false;
  return ancestorsOf(path.resolve(dir)).some((candidate) => accepted(projects[candidate]));
}

/** Reads Claude Code's config; a missing or unreadable file trusts nothing. */
export async function claudeTrusts(dir: string, configFile: string = claudeUserConfigFile()): Promise<boolean> {
  try {
    const config: unknown = JSON.parse(await readFile(configFile, "utf8"));
    return isRecord(config) && isTrustedByClaude(dir, config.projects);
  } catch {
    return false;
  }
}
