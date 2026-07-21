// The "tell me about this directory" routes: everything a terminal cell asks for once it
// knows its working dir. They share one shape — resolve `?cwd=`, then read something about
// that dir — and none of them touch session state, which is why they come out of index.ts
// first (#548 step 2). Dependencies are all already-extracted modules, so nothing is
// injected; the mount only needs the app.
import type { Express } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import { workspaceFromQuery } from "../config/workspace.js";
import { getHeaderConfig } from "../config/config-routes.js";
import { publicDirConfig, dirSoundFile, loadDirConfig } from "../config/dir-config.js";
import { buildHeaderContext, loadHeaderConfig, repoFromWebUrl } from "../config/header-context.js";
import { headerHasPrButton, resolveHeader } from "../config/header-resolve.js";
import { loadScripts } from "../files/scripts.js";
import { gitStatus } from "../git/git-status.js";
import { resolveGithubUrl } from "../git/gitRemote.js";
import { phaseForRepoBranch } from "../git/prPhase.js";
import { prUrlForBranch } from "../git/pr-for-branch.js";
import { applySkillFilter, discoverSkills } from "../backends/remoteHost/skills.js";

export function mountDirRoutes(app: Express): void {
  // GRID-ONLY (dev_tool): the `script.json` entries a cell's launcher offers for its
  // chosen directory (?cwd=<dir>, falling back to CLAUDE_CWD). The browser shows
  // these and sends back only an INDEX + the cwd (see /ws/run), so the file is the
  // allowlist of what can run. The resolved `cwd` is returned so the cell runs the
  // script in the same dir it listed scripts for.
  app.get("/api/scripts", (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    res.json({ cwd, scripts: loadScripts(cwd).map((s, index) => ({ index, label: s.label, command: s.command, cwd: s.cwd })) });
  });

  // The `.claude/skills` (user + project scope) discoverable for ?cwd=<dir>, so the
  // terminal header's Skill menu can list them — working-dir skills first. Mirrors
  // /api/scripts: the picked skill is invoked in the running session by typing its
  // /<slug> (agent-side), so the browser only needs the slug + a description tooltip.
  // A per-dir `.mulmoterminal.json` `skills` allowlist narrows/orders the list;
  // absent => show all.
  app.get("/api/skills", async (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    const skills = applySkillFilter(await discoverSkills({ workspaceRoot: cwd }), loadDirConfig(cwd).skills);
    res.json({ cwd, skills });
  });

  app.get("/api/dir-config", (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    res.json(publicDirConfig(cwd));
  });

  // Live git status (branch / dirty / ahead·behind) for a terminal's dir, so the
  // header can show it without the user typing `git status`. A non-git dir is
  // `repo:false`, not an error.
  app.get("/api/git-status", async (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    res.json(await gitStatus(cwd));
  });

  // GRID-ONLY: the workflow phase of a cell's branch — no PR yet / in the review loop / ready
  // to merge / merged (server/git/prPhase.ts). The cockpit roster shows it alongside the agent
  // status. Resolves the branch's repo here (same as the header's PR button); a non-repo dir,
  // detached HEAD, or non-GitHub remote yields `none`. Read-only; the gh call is cached.
  app.get("/api/pr-phase", async (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    const status = await gitStatus(cwd);
    const repo = status.repo && status.branch ? repoFromWebUrl(await resolveGithubUrl(cwd)) : null;
    if (!repo || !status.branch) return res.json({ phase: "none", url: null });
    res.json(await phaseForRepoBranch(repo, status.branch));
  });

  // The resolved terminal-header config (buttons + chips) for a session: global config merged with the
  // dir's, with `when` evaluated and ${vars} substituted for this session's live context. `chips:null`
  // means unconfigured, so the client keeps its default header (see plans/feat-header-toolbar-config.md).
  app.get("/api/header", async (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    const session = typeof req.query.session === "string" && SESSION_ID_RE.test(req.query.session) ? req.query.session : null;
    const agent = req.query.agent === "codex" ? "codex" : "claude";
    const model = typeof req.query.model === "string" ? req.query.model : null;
    const config = loadHeaderConfig(cwd, getHeaderConfig());
    const context = await buildHeaderContext(cwd, { session, agent, model });
    // Resolve the branch's PR URL only when a `pr` button is present (a cached gh call); an open.pr
    // button then opens that URL, or is dropped when there's no open PR.
    if (headerHasPrButton(config) && context.repo && context.branch) {
      context.prUrl = await prUrlForBranch(context.repo, context.branch);
    }
    res.json(resolveHeader(config, context));
  });

  // Stream a directory's custom attention sound. The path never comes from the
  // request — it's read from that dir's .mulmoterminal.json and confined to the dir —
  // so there's no traversal surface. 404 when unset/missing (the client falls back to
  // the global sound, then the built-in chime).
  app.get("/api/dir-sound", (req, res) => {
    const cwd = workspaceFromQuery(req.query.cwd);
    const file = dirSoundFile(cwd);
    if (!file) return res.status(404).end();
    // dotfiles:"allow" — the conventional location is a hidden <cwd>/.mulmoterminal/
    // dir, which send() would otherwise 404. The path is already confined to cwd, so
    // serving from a dot-segment is safe here.
    res.sendFile(file, { dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
}
