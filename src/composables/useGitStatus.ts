// Polls GET /api/git-status for a terminal's dir so the header can always show
// branch / dirty / ahead·behind. Refreshes on mount, on cwd change, and on the
// shared visible-only poll (window focus, tab visibility, a light interval) —
// see usePollWhileVisible. `refresh` is exposed so a caller can force an update
// right after a turn finishes.
import { ref, watch, type Ref } from "vue";
import { usePollWhileVisible } from "./usePollWhileVisible";
import type { GitStatus } from "../../common/gitStatus";
import { isRecord } from "../../common/isRecord";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";
import { dirApiUrl } from "./dirAddress";

const POLL_MS = 10_000;
const isGitStatus = (v: unknown): v is GitStatus => isRecord(v) && typeof v.repo === "boolean";

/** `cwd` is a directory key (dirAddress.ts): a remote one is read through the gateway. */
export function useGitStatus(cwd: Ref<string | null>) {
  const status = ref<GitStatus | null>(null);
  let req = 0;
  let active = 0;

  // `forced` is the exposed refresh — a caller that just saw a turn finish and needs to see
  // what it wrote. The server coalesces same-dir reads, and a read already in flight may have
  // sampled the tree BEFORE the turn wrote, so a forced read asks not to join one (#2164 review).
  async function read(forced: boolean): Promise<void> {
    // Bump the token BEFORE the early return: switching a cell to a dir-less state (e.g. a
    // launcher cell) must invalidate an in-flight fetch for the previous dir, or its late
    // response would apply `my === req` and put the old branch chip back. (#620.)
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      status.value = null;
      return;
    }
    active += 1;
    try {
      const url = dirApiUrl(dir, "/api/git-status", forced ? { fresh: "1" } : {});
      const res = await fetchWithTimeout(url, undefined, SLOW_COMMAND_TIMEOUT_MS);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my === req) status.value = isGitStatus(data) ? data : null;
    } catch {
      // leave the last value; the next tick retries
    } finally {
      active -= 1;
    }
  }

  // Only the TICK may be skipped. The server answer costs four git processes over the whole
  // worktree, so on a busy machine a read outlives the interval — and a tick that fires anyway
  // stacks reads that then slow each other down further (#2164). A cwd change asks about a
  // different directory, and the exposed `refresh` is a deliberate request after a turn; both
  // must go through regardless of what is in flight.
  usePollWhileVisible(() => {
    if (active === 0) void read(false);
  }, POLL_MS);
  watch(cwd, () => void read(false));

  return { status, refresh: () => read(true) };
}
