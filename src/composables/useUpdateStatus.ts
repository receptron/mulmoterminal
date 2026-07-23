import { ref, computed, onMounted, onUnmounted } from "vue";
import { parseUpdateNotice } from "./updateNotice";

// The server runs the check at startup and it reaches the network (git ls-remote can take
// several seconds), so an early read returns null before it lands. Poll a few times to catch a
// notice that shows up late, then stop — a genuinely up-to-date server just answers null each
// time.
const POLL_MS = 3000;
const MAX_POLLS = 5;

// The header's "update available" badge state, read from GET /api/update-status (the server's
// startup check). Best-effort — any failure just leaves the badge hidden.
export function useUpdateStatus() {
  const notice = ref<string | null>(null);
  const badge = computed(() => parseUpdateNotice(notice.value));

  async function fetchOnce(): Promise<void> {
    try {
      const res = await fetch("/api/update-status");
      if (!res.ok) return;
      const data = await res.json();
      // Assign both ways: a null answer must CLEAR a notice an earlier read picked up (e.g.
      // after a `git pull` + restart), not just be ignored.
      notice.value = typeof data?.notice === "string" ? data.notice : null;
    } catch {
      // best-effort — no badge is fine
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let polls = 0;
  async function poll(): Promise<void> {
    await fetchOnce();
    polls += 1;
    // Keep polling only while there's nothing to show and we haven't given up: once a notice
    // arrives it won't change without a restart, and a null is either "current" or "not ready".
    if (notice.value === null && polls < MAX_POLLS) timer = setTimeout(() => void poll(), POLL_MS);
  }

  onMounted(() => void poll());
  onUnmounted(() => timer && clearTimeout(timer));

  return { badge };
}
