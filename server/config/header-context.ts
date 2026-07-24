// Gather a session's live HeaderContext (cwd, git status, model, agent, …) so a merged HeaderConfig
// can be resolved for it, and merge the global (AppConfig) + per-dir (.mulmoterminal.json) configs.

import path from "node:path";
import os from "node:os";
import { gitStatus } from "../git/git-status.js";
import { git } from "../git/worktrees.js";
import { parseGithubWebUrl } from "../git/gitRemote.js";
import { mergeHeaderConfig, type HeaderConfig, type HeaderContext } from "./header-config.js";
import { loadDirConfig } from "./dir-config.js";

const WORKTREES_ROOT = path.join(os.homedir(), ".mulmoterminal", "worktrees");

// The GitHub web URL is "https://github.com/owner/repo" — take the "owner/repo" tail for ${repo}.
export function repoFromWebUrl(webUrl: string | null): string | null {
  if (!webUrl) return null;
  const parts = webUrl.split("github.com/");
  if (parts.length < 2) return null;
  let repo = parts[1];
  if (repo.endsWith(".git")) repo = repo.slice(0, -".git".length);
  while (repo.endsWith("/")) repo = repo.slice(0, -1);
  return repo || null;
}

// A managed worktree lives at <root>/<repo>-<hash>/<task>. The task is the FIRST segment
// under <root> — NOT path.basename, which would return the wrong name for any cwd deeper
// than the task dir itself (a session working in <task>/src would read as "src"). Root is a
// parameter so the rule is unit-testable without the real home dir. Exported for that test.
export function worktreeTask(cwd: string, root: string = WORKTREES_ROOT): string | null {
  const resolved = path.resolve(cwd);
  const prefix = root + path.sep;
  if (!resolved.startsWith(prefix)) return null;
  // segments[0] = "<repo>-<hash>", segments[1] = "<task>", anything after is inside the task.
  const segments = resolved.slice(prefix.length).split(path.sep);
  return segments[1] ?? null;
}

async function remoteInfo(cwd: string): Promise<{ remoteUrl: string | null; repo: string | null }> {
  const res = await git(["remote", "get-url", "origin"], cwd);
  const remoteUrl = res.ok && res.stdout.trim() ? res.stdout.trim() : null;
  const repo = remoteUrl ? repoFromWebUrl(parseGithubWebUrl(remoteUrl)) : null;
  return { remoteUrl, repo };
}

export interface SessionMeta {
  session: string | null;
  agent: "claude" | "codex";
  model: string | null;
}

export async function buildHeaderContext(cwd: string, meta: SessionMeta): Promise<HeaderContext> {
  const status = await gitStatus(cwd);
  const remote = status.repo ? await remoteInfo(cwd) : { remoteUrl: null, repo: null };
  return {
    dir: cwd,
    dirName: path.basename(cwd),
    branch: status.branch,
    repo: remote.repo,
    model: meta.model,
    agent: meta.agent,
    session: meta.session,
    remoteUrl: remote.remoteUrl,
    dirty: status.dirty,
    ahead: status.ahead,
    behind: status.behind,
    task: worktreeTask(cwd),
    isGitRepo: status.repo,
    prUrl: null, // resolved by the /api/header route only when a `pr` button is present
  };
}

// Merge the global header config (from AppConfig) under the per-dir one (<cwd>/.mulmoterminal.json).
export function loadHeaderConfig(cwd: string, globalConfig: HeaderConfig): HeaderConfig {
  const dir = loadDirConfig(cwd);
  return mergeHeaderConfig(globalConfig, { buttons: dir.buttons, chips: dir.chips });
}
