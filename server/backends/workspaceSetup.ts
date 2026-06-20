// Workspace bootstrap — thin host binding over @mulmoclaude/workspace-setup
// (shared with MulmoClaude). Seeds the bundled help docs and preset skills
// into the shared workspace so a MulmoTerminal-alone run (without MulmoClaude
// ever booting) still gets a populated workspace.
//
// Destinations MUST match MulmoClaude's layout exactly (both apps share
// CLAUDE_CWD, default ~/mulmoclaude) so the two never diverge on disk:
//   helps          → <workspace>/config/helps
//   preset catalog → <workspace>/data/skills/catalog/preset
//   active presets → <workspace>/.claude/skills   (already-starred mc-* only)
// (See mulmoclaude/server/workspace/paths.ts: WORKSPACE_DIRS.{helps,
// skillsCatalogPreset,claudeSkills}.)

import path from "node:path";
import { seedHelps, syncPresetSkills, syncActivePresetSkills, presetSkillsAssetDir } from "@mulmoclaude/workspace-setup";

export function initWorkspaceSetup(deps: { workspace: string }): void {
  const { workspace } = deps;
  const onInfo = (message: string, data?: Record<string, unknown>) => console.log(`[workspace-setup] ${message}`, data ?? "");
  const onWarn = (message: string, data?: Record<string, unknown>) => console.warn(`[workspace-setup] ${message}`, data ?? "");

  // Always refresh the bundled help docs (idempotent).
  seedHelps({ destDir: path.join(workspace, "config", "helps") });

  // Seed/refresh preset skills into the catalog. Catalog entries are visible to
  // UI / tooling but NOT discovered by Claude Code's slash-command resolver, so
  // they don't enter the system prompt unless explicitly starred into the
  // active layer.
  syncPresetSkills({
    sourceDir: presetSkillsAssetDir(),
    destDir: path.join(workspace, "data", "skills", "catalog", "preset"),
    onInfo,
    onWarn,
  });

  // Refresh the ACTIVE copy of any already-starred mc-* preset so a user who
  // starred one earlier doesn't stay pinned to a stale (buggy) version. Only
  // mc-* slugs are touched; user-authored skills are never modified, and slugs
  // that aren't starred yet are left alone (never auto-starred).
  syncActivePresetSkills({
    sourceDir: presetSkillsAssetDir(),
    activeDir: path.join(workspace, ".claude", "skills"),
    onInfo,
    onWarn,
  });
}
