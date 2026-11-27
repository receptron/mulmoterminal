# fix: background git reads take no optional lock (#3556)

## Problem

`git status` refreshes a stale index and writes it back under `.git/index.lock`. MulmoTerminal polls
`git status --porcelain` per open cell (dirty count, file-tree status, worktree checks). When a
user's script runs `git add` / `commit` / `switch` in the same repo while a poll is writing, the
script fails at once with `index.lock: File exists` — git does not wait for that lock.

Reproduced: a background `git status` loop beside repeated `git add` fails a share of the adds;
`git --no-optional-locks status` in the loop fails none.

## Fix

- `server/git/git-env.ts`: pure `withoutOptionalLocks(env)` adds `GIT_OPTIONAL_LOCKS=0`.
- `git()` in `server/git/worktrees.ts` passes it to every child, so every caller is covered,
  including future ones. The variable only drops optional locks; the mandatory locks of real
  writes (`worktree add`, `commit`, ...) are unchanged.
- `server/backends/sharedApp/context.ts` spawns git directly with `execFileAsync`; it gets the same env.

## Left out

- `server/git/gitRemote.ts` (`git config --get`) never touches the index.
- `bin/update-check.js` runs once at startup against the package's own checkout, not a user repo.

## Trade-off

A status that no longer writes its refresh back may re-stat a little more on the next run in a
large repo. Writing it back is exactly what collides with the user's lock.

## Test

`test/server/git/git-optional-locks.spec.ts`: the pure function, plus a real repo where a plain
`git status` on a stale index rewrites `.git/index` (the control) and `git()` leaves it byte-identical.
