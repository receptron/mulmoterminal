// HTTP routes for per-agent git worktree isolation (see worktrees.ts). The launcher
// uses these to detect a git repo, list/reuse existing worktrees, and create/remove
// them. Mutations are same-origin guarded like the other local-only routes; remove
// uses POST (not DELETE) so a request body survives every proxy.
import type { Express } from "express";
import { repoRoot, defaultBaseBranch, listWorktrees, createWorktree, removeWorktree, isDirty } from "./worktrees.js";
import { worktreeDiff } from "./worktree-diff.js";

interface WorktreeRouteOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

export function mountWorktreeRoutes(app: Express, { isAllowedOrigin }: WorktreeRouteOptions): void {
  // Repo status + the managed worktrees for a cell's chosen dir (each with `dirty`
  // so the UI can confirm before deleting). A non-git dir is `isGit:false`, not an
  // error — the launcher just hides the worktree UI.
  app.get("/api/worktrees", async (req, res) => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : "";
    const repo = cwd ? await repoRoot(cwd) : null;
    if (!repo) return res.json({ isGit: false, base: null, worktrees: [] });
    const list = await listWorktrees(repo);
    const worktrees = await Promise.all(list.map(async (w) => ({ ...w, dirty: await isDirty(w.path) })));
    res.json({ isGit: true, base: await defaultBaseBranch(repo), worktrees });
  });

  // Read-only diff of a worktree vs its base branch (ahead/dirty counts + changed
  // files + patch), so a cell can show what the agent changed. A non-worktree dir
  // is `isWorktree:false`, not an error.
  app.get("/api/worktrees/diff", async (req, res) => {
    const cwd = typeof req.query.cwd === "string" ? req.query.cwd : "";
    res.json(cwd ? await worktreeDiff(cwd) : { isWorktree: false, base: null, ahead: 0, dirty: 0, files: [], patch: "", truncated: false });
  });

  app.post("/api/worktrees/create", async (req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).end();
    const { repoDir, task } = req.body ?? {};
    if (typeof repoDir !== "string" || typeof task !== "string" || !task.trim()) {
      return res.status(400).json({ error: "repoDir and a non-empty task are required" });
    }
    const wt = await createWorktree(repoDir, task);
    if (!wt) return res.status(500).json({ error: "could not create the worktree (is this a git repo?)" });
    res.json(wt);
  });

  // Remove a managed worktree. 409 for a client-resolvable conflict (dirty → the UI
  // re-confirms with `force`; not-managed → a bad path), 500 for an internal git
  // failure the client can't fix by retrying.
  app.post("/api/worktrees/remove", async (req, res) => {
    if (!isAllowedOrigin(req.headers.origin)) return res.status(403).end();
    const { repoDir, path: worktreePath, deleteBranch, force } = req.body ?? {};
    if (typeof repoDir !== "string" || typeof worktreePath !== "string") {
      return res.status(400).json({ error: "repoDir and path are required" });
    }
    // Strict `=== true` (not `!!`) for the destructive flags: a mistyped truthy
    // payload (e.g. the string "false") must fall back to the SAFE default — never
    // force-remove a dirty worktree or delete a branch on a malformed request.
    const result = await removeWorktree(repoDir, worktreePath, { deleteBranch: deleteBranch === true, force: force === true });
    if (result.ok) return res.json(result);
    res.status(result.reason === "failed" ? 500 : 409).json(result);
  });
}
