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
import { homedir } from "node:os";
import { seedHelps, syncPresetSkills, syncActivePresetSkills, presetSkillsAssetDir } from "@mulmoclaude/workspace-setup";

/** True only for the MANAGED mulmoclaude workspace — the server default
 *  (~/mulmoclaude) or an explicit MULMOCLAUDE_WORKSPACE_PATH. We seed only there.
 *
 *  The launcher resolves CLAUDE_CWD to the directory `npx mulmoterminal` was run
 *  from when no --cwd is given (bin/mulmoterminal.js resolveCwd), so seeding
 *  unconditionally would write mulmoclaude presets/helps — and refresh entries
 *  under `.claude/skills`, which many dev repos already have — into whatever
 *  project the user happened to launch from. Gating to the managed workspace
 *  keeps the terminal usable in any dir without polluting it. */
export function isManagedWorkspace(workspace: string): boolean {
  const resolved = path.resolve(workspace);
  const candidates = [path.join(homedir(), "mulmoclaude")];
  if (process.env.MULMOCLAUDE_WORKSPACE_PATH) candidates.push(process.env.MULMOCLAUDE_WORKSPACE_PATH);
  return candidates.some((candidate) => path.resolve(candidate) === resolved);
}

// Each seeding step is fault-isolated: a filesystem edge case (EACCES, ENOSPC, a
// path collision) in one step must neither abort server boot nor block the other
// steps. The package's sync paths are already best-effort internally; this guards
// the rest (seedHelps) and the call site so the whole thing can never throw.
function safeStep(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    console.warn(`[workspace-setup] ${label} failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function initWorkspaceSetup(deps: { workspace: string }): void {
  const { workspace } = deps;
  // Never seed an arbitrary launcher cwd — only the managed mulmoclaude workspace.
  if (!isManagedWorkspace(workspace)) {
    console.log(`[workspace-setup] skipping seed for non-managed workspace: ${workspace}`);
    return;
  }
  const onInfo = (message: string, data?: Record<string, unknown>) => console.log(`[workspace-setup] ${message}`, data ?? "");
  const onWarn = (message: string, data?: Record<string, unknown>) => console.warn(`[workspace-setup] ${message}`, data ?? "");

  // Always refresh the bundled help docs (idempotent).
  safeStep("seed helps", () => seedHelps({ destDir: path.join(workspace, "config", "helps") }));

  // Seed/refresh preset skills into the catalog. Catalog entries are visible to
  // UI / tooling but NOT discovered by Claude Code's slash-command resolver, so
  // they don't enter the system prompt unless explicitly starred into the
  // active layer.
  safeStep("sync preset catalog", () =>
    syncPresetSkills({
      sourceDir: presetSkillsAssetDir(),
      destDir: path.join(workspace, "data", "skills", "catalog", "preset"),
      onInfo,
      onWarn,
    }),
  );

  // Refresh the ACTIVE copy of any already-starred mc-* preset so a user who
  // starred one earlier doesn't stay pinned to a stale (buggy) version. Only
  // mc-* slugs are touched; user-authored skills are never modified, and slugs
  // that aren't starred yet are left alone (never auto-starred).
  safeStep("refresh active presets", () =>
    syncActivePresetSkills({
      sourceDir: presetSkillsAssetDir(),
      activeDir: path.join(workspace, ".claude", "skills"),
      onInfo,
      onWarn,
    }),
  );
}
