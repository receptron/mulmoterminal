// Gather a session's live HeaderContext (cwd, git status, model, agent, …) so a merged HeaderConfig
// can be resolved for it, and merge the global (AppConfig) + per-dir (.mulmoterminal.json) configs.

import path from "node:path";
import os from "node:os";
import { gitStatus } from "../git/git-status.js";
import { git } from "../git/worktrees.js";
import { parseGithubWebUrl } from "../git/gitRemote.js";
import { mergeHeaderConfig, type HeaderConfig, type HeaderContext } from "./header-config.js";
import { loadDirConfig } from "./dir-config.js";
import { isStrictlyWithin } from "../infra/path-within.js";
import { parseRemoteRef } from "../git/remote-ref.js";
import { GITHUB_HOST } from "../git/gitRemote.js";

const WORKTREES_ROOT = path.join(os.homedir(), ".mulmoterminal", "worktrees");

// The repository path in a web URL — `owner/repo` out of "https://github.com/owner/repo" — for
// ${repo}. Parsed with the shared remote parser rather than by splitting on the host name (#981);
// the GitHub check stays, because ${repo} is interpolated into https://github.com/${repo} by the
// default header button, so a path from another host would build a link to the wrong site.
// Widening that is part of the forge abstraction, not of moving the parsing.
export function repoFromWebUrl(webUrl: string | null): string | null {
  const ref = webUrl ? parseRemoteRef(webUrl) : null;
  return ref?.host === GITHUB_HOST ? ref.path : null;
}

// A managed worktree lives at <root>/<repo>-<hash>/<task>. The task is the FIRST segment
// under <root> — NOT path.basename, which would return the wrong name for any cwd deeper
// than the task dir itself (a session working in <task>/src would read as "src"). Root is a
// parameter so the rule is unit-testable without the real home dir. Exported for that test.
export function worktreeTask(cwd: string, root: string = WORKTREES_ROOT): string | null {
  if (!isStrictlyWithin(root, cwd)) return null;
  // segments[0] = "<repo>-<hash>", segments[1] = "<task>", anything after is inside the task.
  const segments = path.relative(path.resolve(root), path.resolve(cwd)).split(path.sep);
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
  agent: "claude" | "codex" | "antigravity";
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
