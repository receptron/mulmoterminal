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
// path on call, not at module load.
import fs from "fs/promises";
import path from "path";
import type { FileOps } from "gui-chat-protocol";

const ARTIFACTS_DIR = "artifacts";

let workspace: string | null = null;

export function initArtifactsBackend(deps: { workspace: string }): void {
  workspace = deps.workspace;
}

// Resolve an artifacts-root-relative path to an absolute one, rejecting traversal
// or absolute inputs so a plugin can never escape <workspace>/artifacts.
function absFor(rel: string): string {
  if (!workspace) throw new Error("artifacts backend not initialised (missing workspace)");
  const root = path.resolve(workspace, ARTIFACTS_DIR);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`artifacts path escapes the artifacts root: ${rel}`);
  }
  return abs;
}

export const artifactsFileOps: FileOps = {
  async read(rel) {
    return fs.readFile(absFor(rel), "utf8");
  },
  async readBytes(rel) {
    return new Uint8Array(await fs.readFile(absFor(rel)));
  },
  async write(rel, content) {
    const abs = absFor(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  },
  async readDir(rel) {
    return fs.readdir(absFor(rel));
  },
  async stat(rel) {
    const s = await fs.stat(absFor(rel));
    return { mtimeMs: s.mtimeMs, size: s.size };
  },
  async exists(rel) {
    try {
      await fs.access(absFor(rel));
      return true;
    } catch {
      return false;
    }
  },
  async unlink(rel) {
    await fs.rm(absFor(rel), { force: true });
  },
};
