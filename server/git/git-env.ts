// `git status` refreshes a stale index and writes it back under `.git/index.lock`. git has no wait
// for that lock, so a user's own `git add` / `commit` landing during one of our polls fails with
// "index.lock: File exists" (#3556). GIT_OPTIONAL_LOCKS=0 drops only that optional write; the
// locks a real write takes (add, commit, worktree add) are mandatory and unaffected.
export function withoutOptionalLocks(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, GIT_OPTIONAL_LOCKS: "0" };
}
