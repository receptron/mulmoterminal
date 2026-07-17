// Generic artifacts FileOps backend — the gui-chat-protocol `files.artifacts`
// runtime capability a plugin's execute() reaches through `context.files.artifacts`.
// Currently consumed by @mulmoclaude/chart-plugin's executeChart, which writes
// `charts/<YYYY>/<MM>/<slug>-<ts>.chart.json` into the shared, user-browsable
// artifacts area. Any future package needing plain artifact I/O uses the same ops.
//
// Rooted at <workspace>/artifacts (workspace = CLAUDE_CWD), so a plugin's
// artifacts-root-relative `rel` (e.g. `charts/2026/06/foo.chart.json`) lands at
// <workspace>/artifacts/<rel>. The workspace is injected lazily at boot
// (initArtifactsBackend, called from server/index.ts) — the plugins-registry
// closures capture `artifactsFileOps` at import time, so every op resolves the
// path on call, not at module load. The rooting + traversal guard live in
// createFileOps (backends/fileOps.ts), shared with the per-plugin data/config areas.
import path from "path";
import { createFileOps } from "./fileOps.js";

const ARTIFACTS_DIR = "artifacts";

let workspace: string | null = null;

export function initArtifactsBackend(deps: { workspace: string }): void {
  workspace = deps.workspace;
}

export function artifactsRoot(): string {
  if (!workspace) throw new Error("artifacts backend not initialised (missing workspace)");
  return path.resolve(workspace, ARTIFACTS_DIR);
}

export const artifactsFileOps = createFileOps(artifactsRoot, "artifacts");
