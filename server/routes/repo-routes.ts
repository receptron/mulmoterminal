// The /prs and /issues views: open pull requests and issues across the repos the user
// configured, via the server's own `gh` login. Repos come from config, never the request.
import type { Express } from "express";
import { getPrRepos } from "../config/config-routes.js";
import { listPrsAcrossRepos } from "../git/prs.js";
import { listIssuesAcrossRepos } from "../git/issues.js";

export function mountRepoRoutes(app: Express): void {
  // Cross-repo PR list (the /prs view): aggregate open PRs for the configured repos via
  // the server's `gh` login. Repos come from config (never the request).
  app.get("/api/prs", async (_req, res) => {
    try {
      res.json({ repos: await listPrsAcrossRepos(getPrRepos()) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Sibling of /api/prs: the same configured repos' open issues (capped per repo).
  app.get("/api/issues", async (_req, res) => {
    try {
      res.json({ repos: await listIssuesAcrossRepos(getPrRepos()) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
