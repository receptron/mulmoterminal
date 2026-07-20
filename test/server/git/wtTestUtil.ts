import { rmSync } from "node:fs";

// Windows keeps a brief handle on a worktree dir after the git child that touched it
// exits, so a plain rmSync in teardown throws EBUSY/ENOTEMPTY. rmSync's own retry loop
// waits that out; force so a missing dir is a no-op. A no-op everywhere else.
export function rmDirRetrying(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// A local git chain (init → worktree add → commit → push) runs several child processes
// per test; on the Windows CI runner that overruns vitest's 5s default. Give the
// integration tests room — a no-op cost on the fast platforms.
export const GIT_TEST_TIMEOUT_MS = 30_000;
