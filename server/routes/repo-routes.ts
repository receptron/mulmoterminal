// The /prs and /issues views: open pull requests and issues across the repos the user
// configured, via the server's own `gh` login. Repos come from config, never the request.
import type { Express } from "express";
import { getCwdPresets, getPrRepos, getRepoDirs } from "../config/config-routes.js";
import { listPrsAcrossRepos } from "../git/prs.js";
import { listIssuesAcrossRepos } from "../git/issues.js";
import { repoDirsFromPresets } from "../git/repo-dirs.js";
import { readStarState, starRepo } from "../git/github-star.js";
import type { GithubStarState } from "../../common/githubRepo.js";
import type { RepoDirsResponse } from "../../common/repoDirs.js";
import type { BoardResponse } from "../../common/githubBoard.js";
import { boardAcrossRepos, boardDetail, liveCellRepos, type LiveCell } from "../git/board-fetch.js";
import { requiredLgtmOfRepo } from "../git/repo-review.js";
import { parseBoardDetailQuery } from "../git/board-detail.js";
import { unconfiguredRepos, withUnregisteredLists } from "../git/board-repos.js";
import { activity, ptys } from "../session/registry.js";

const liveBoardCells = (): LiveCell[] =>
  [...ptys.entries()].flatMap(([session, entry]): LiveCell[] => {
    if (!entry.cwd) return [];
    const state = activity.get(session);
    return [{ session, cwd: entry.cwd, working: state?.working ?? false, waiting: state?.waiting ?? false }];
  });

const unregisteredRepos = async (): Promise<string[]> => unconfiguredRepos(getPrRepos(), await liveCellRepos(liveBoardCells()));

export function mountRepoRoutes(app: Express): void {
  // Cross-repo PR list (the /prs view): aggregate open PRs for the configured repos, then the GitHub
  // repos a live cell is in (#3377), via the server's `gh` login. Repos never come from the request.
  app.get("/api/prs", async (_req, res) => {
    try {
      res.json({ repos: await withUnregisteredLists(getPrRepos(), unregisteredRepos, listPrsAcrossRepos) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Sibling of /api/prs: the same repos' open issues (capped per repo).
  app.get("/api/issues", async (_req, res) => {
    try {
      res.json({ repos: await withUnregisteredLists(getPrRepos(), unregisteredRepos, listIssuesAcrossRepos) });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // The experimental board (#3172): the same repos' issues and PRs as cards in progress columns,
  // with the live cells working on each. Repos from config plus the GitHub repos a cell is in (#3372);
  // cells from this process's own PTYs.
  app.get("/api/github/board", async (_req, res) => {
    try {
      const body: BoardResponse = { repos: await boardAcrossRepos(getPrRepos(), liveBoardCells(), requiredLgtmOfRepo) };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // One card's detail panel (#3177): the issue's body and the PR's checks and reviews, read when the
  // panel opens. Only for a configured repo or one a live cell is in — the query names the repo, the
  // server's own state decides it may.
  app.get("/api/github/board/detail", async (req, res) => {
    const query = parseBoardDetailQuery(req.query);
    if (!query) return res.status(400).json({ error: "repo (owner/repo) and a positive issue and/or pr number are required" });
    try {
      const allowed = [...getPrRepos(), ...(await liveCellRepos(liveBoardCells()))];
      const body = await boardDetail(query.repo, allowed, query.issue, query.pr);
      if (!body) return res.status(404).json({ error: `${query.repo} is not a configured GitHub repository or one a terminal is open in` });
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Where work on a repo can start: the saved directories grouped by the GitHub repo they clone,
  // with the recorded choice per repo (#1172). Derived from `cwdPresets`, never from the request —
  // this names local paths, and a caller must not be able to ask about a directory of its own
  // choosing. A repo with no clone here is absent, which is how the caller learns it cannot start.
  app.get("/api/repo-dirs", async (_req, res) => {
    try {
      const body: RepoDirsResponse = { repos: await repoDirsFromPresets(getCwdPresets(), getRepoDirs()) };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // The header's "star this project on GitHub" button. Not a configured repo like the two
  // above — it is always this project, so the target is a constant and never the request.
  // `starred: null` is "cannot tell" (no `gh`, not logged in, offline), which hides the button.
  app.get("/api/github/star", async (_req, res) => {
    try {
      const body: GithubStarState = { starred: await readStarState() };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Stars the repo through the user's `gh` login. A write, so the app-wide same-origin gate
  // (app-routes.ts) covers it: a page the user happens to visit must not star on their behalf.
  app.post("/api/github/star", async (_req, res) => {
    try {
      const body: GithubStarState = { starred: await starRepo() };
      res.json(body);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
