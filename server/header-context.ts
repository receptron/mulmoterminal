// Gather a session's live HeaderContext (cwd, git status, model, agent, …) so a merged HeaderConfig
// can be resolved for it, and merge the global (AppConfig) + per-dir (.mulmoterminal.json) configs.

import path from "node:path";
import os from "node:os";
import { gitStatus } from "./git-status.js";
import { git } from "./worktrees.js";
import { parseGithubWebUrl } from "./gitRemote.js";
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

// A managed worktree lives at ~/.mulmoterminal/worktrees/<repo>-<hash>/<task>; its dir name is the task.
function worktreeTask(cwd: string): string | null {
  const resolved = path.resolve(cwd);
  return resolved.startsWith(WORKTREES_ROOT + path.sep) ? path.basename(resolved) : null;
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
