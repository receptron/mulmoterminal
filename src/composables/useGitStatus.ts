// Polls GET /api/git-status for a terminal's dir so the header can always show
// branch / dirty / ahead·behind. Refreshes on mount, on cwd change, on window
// focus, and on a light interval (only while the tab is visible). `refresh` is
// exposed so a caller can force an update right after a turn finishes.
import { ref, watch, onMounted, onUnmounted, type Ref } from "vue";

export interface GitStatus {
  repo: boolean;
  branch: string | null;
  detached: boolean;
  dirty: number;
  ahead: number;
  behind: number;
  upstream: boolean;
}

const POLL_MS = 10_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isGitStatus = (v: unknown): v is GitStatus => isRecord(v) && typeof v.repo === "boolean";

export function useGitStatus(cwd: Ref<string | null>) {
  const status = ref<GitStatus | null>(null);
  let req = 0;

  async function refresh(): Promise<void> {
    // Bump the token BEFORE the early return: switching a cell to a dir-less state (e.g. a
    // launcher cell) must invalidate an in-flight fetch for the previous dir, or its late
    // response would apply `my === req` and put the old branch chip back. (#620.)
    const my = ++req;
    const dir = cwd.value;
    if (!dir) {
      status.value = null;
      return;
    }
    try {
      const res = await fetch(`/api/git-status?cwd=${encodeURIComponent(dir)}`);
      if (!res.ok) return;
      const data: unknown = await res.json();
      if (my === req) status.value = isGitStatus(data) ? data : null;
    } catch {
      // leave the last value; the next tick retries
    }
  }

  const refreshIfVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };

  let timer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    refresh();
    window.addEventListener("focus", refreshIfVisible);
    timer = setInterval(refreshIfVisible, POLL_MS);
  });
  onUnmounted(() => {
    window.removeEventListener("focus", refreshIfVisible);
    if (timer) clearInterval(timer);
  });
  watch(cwd, refresh);

  return { status, refresh };
}
