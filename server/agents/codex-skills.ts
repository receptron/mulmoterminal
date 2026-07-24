import { existsSync, readdirSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Marks a codex skill dir mulmoterminal owns, so a re-sync overwrites OURS but never clobbers
// codex's own curated/system skills.
const MIRROR_MARKER = ".mt-mirror";
// A safe skill slug: alnum start, then letters/digits/underscore/hyphen. Shared with
// skill discovery so a directory whose name isn't a clean slug (whitespace, quotes,
// newlines) never becomes a runnable skill and can't alter the /<slug> we inject.
export const SLUG_RE = /^[a-z0-9][\w-]*$/i;

export function codexSkillsRoot(): string {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "skills");
}

const isOurs = (dir: string): boolean => existsSync(path.join(dir, MIRROR_MARKER));

const directoryNames = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

// Delete mirrors we own (marker present) whose source skill is gone from the workspace, so
// removing a skill from .claude/skills actually un-mirrors it from codex. Without this a
// deleted skill's mirror survives every sync and codex keeps auto-loading it forever; the
// claude side prunes retired skills for exactly this reason, and the two must not diverge.
// Only marked dirs are touched — codex's own skills (no marker) are never removed.
function removeOrphanedMirrors(destDir: string, keep: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  for (const name of directoryNames(destDir)) {
    if (keep.has(name)) continue;
    const dst = path.join(destDir, name);
    if (!isOurs(dst)) continue;
    rmSync(dst, { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

// Mirror each skill dir from the workspace's .claude/skills into codex's skills dir (same SKILL.md
// format), so codex loads them by description like claude does. Skips any name codex already owns
// (no marker) to avoid clobbering codex's own skills; re-copies ours fresh so edits in the workspace
// propagate; and deletes our mirrors whose source skill was removed, so a whole-skill deletion
// propagates too (not just file removals inside a still-present skill).
export function syncCodexSkills(sourceDir: string, destDir: string): { mirrored: string[]; skipped: string[]; removed: string[] } {
  const mirrored: string[] = [];
  const skipped: string[] = [];
  if (!existsSync(sourceDir)) {
    // Source gone entirely — every mirror we own is now orphaned.
    const removed = existsSync(destDir) ? removeOrphanedMirrors(destDir, new Set()) : [];
    return { mirrored, skipped, removed };
  }
  mkdirSync(destDir, { recursive: true });
  const names = directoryNames(sourceDir);
  for (const name of names) {
    const dst = path.join(destDir, name);
    if (existsSync(dst) && !isOurs(dst)) {
      skipped.push(name);
      continue;
    }
    rmSync(dst, { recursive: true, force: true });
    cpSync(path.join(sourceDir, name), dst, { recursive: true });
    writeFileSync(path.join(dst, MIRROR_MARKER), "managed by mulmoterminal\n");
    mirrored.push(name);
  }
  const removed = removeOrphanedMirrors(destDir, new Set(names));
  return { mirrored, skipped, removed };
}

// codex has no /<slug> command (skills auto-load by description), so a collection chat seed
// "/<slug> <msg>" is rewritten to NAME the skill in natural language — which makes codex load the
// mirrored skill. A non-slash seed (a collection action's natural-language prompt) is unchanged.
export function codexifySkillSeed(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return message;
  const space = trimmed.search(/\s/);
  const slug = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
  if (!SLUG_RE.test(slug)) return message; // not a /<slug> seed — leave it alone
  const rest = space === -1 ? "" : trimmed.slice(space + 1).trim();
  return rest ? `Use the "${slug}" skill.\n\n${rest}` : `Use the "${slug}" skill.`;
}
