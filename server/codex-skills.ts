import { existsSync, readdirSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// Marks a codex skill dir mulmoterminal owns, so a re-sync overwrites OURS but never clobbers
// codex's own curated/system skills.
const MIRROR_MARKER = ".mt-mirror";
const SLUG_RE = /^[a-z0-9][\w-]*$/i;

export function codexSkillsRoot(): string {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return path.join(home, "skills");
}

const isOurs = (dir: string): boolean => existsSync(path.join(dir, MIRROR_MARKER));

// Mirror each skill dir from the workspace's .claude/skills into codex's skills dir (same SKILL.md
// format), so codex loads them by description like claude does. Skips any name codex already owns
// (no marker) to avoid clobbering codex's own skills; re-copies ours fresh so edits/removals in the
// workspace propagate.
export function syncCodexSkills(sourceDir: string, destDir: string): { mirrored: string[]; skipped: string[] } {
  const mirrored: string[] = [];
  const skipped: string[] = [];
  if (!existsSync(sourceDir)) return { mirrored, skipped };
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(sourceDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
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
  return { mirrored, skipped };
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
