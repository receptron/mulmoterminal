# fix: a codex implementer can commit in its issue worktree (#3454)

## Problem

A linked worktree keeps its git metadata in the clone: `.git/worktrees/<name>` plus the shared
`objects`, `refs` and `logs`. codex's `workspace-write` sandbox writes only the working directory, so a
codex implementer started by `startIssueSession` stopped on an approval prompt at its first
`git commit` (`index.lock: Operation not permitted`).

## Measured with `codex exec` on a scratch clone and worktree

- Naming the clone's `.git` as a writable root does not help: codex keeps any `.git` under a writable
  root read-only.
- Naming the worktree's git dir and the shared `objects`, `refs`, `logs` one by one makes commit,
  fetch, merge and push succeed.
- Without `config`, `push -u` cannot record the upstream, but the push lands (exit 0).

## Change

- `worktreeGitWritableRoots(gitDir, commonDir)` (pure, `server/agents/codex/codex-git-roots.ts`) lists
  those paths, plus `packed-refs` and its lock. It lists nothing when the two are the same directory,
  which means a plain clone rather than a linked worktree.
- `worktreeGitRoots(cwd)` asks `git rev-parse --git-dir --git-common-dir`. It answers nothing when git
  cannot say.
- `implementerSpawn` passes the result as `writableRoots`. The issue spawner hands it to codex only.
  `buildCodexArgs` emits `-c sandbox_workspace_write.writable_roots=[...]` with each path written as a
  JSON string, which is valid as a TOML basic string.
- en/ja `config.md` say what the implementer may write.

## Deliberately not writable

The clone's `config` and `hooks`. Writing either (`core.hooksPath`, a hook) runs code outside the
sandbox the next time anyone uses git in that clone. For the same reason nothing is named in a clone
with `extensions.worktreeConfig` on: git then reads `config.worktree` from the worktree's own git dir.

## Out of scope

- A cold resume of the implementer (a restart, then the cell reconnects) respawns codex without the
  roots, as it already does without `networkAccess`. Keeping per-spawn sandbox grants across a resume
  needs a persisted record, like the GUI group restriction (#3033). That is a change of its own, and
  it covers the reviewer and the network as well.

The reviewer (it neither commits nor pushes), and a codex cell the user opens themselves.
