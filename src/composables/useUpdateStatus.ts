import { ref, computed, onMounted } from "vue";
import { parseUpdateNotice } from "./updateNotice";

// The launcher writes update-status.json asynchronously after startup, so the file may not
// exist yet on the first load. One delayed re-fetch catches a notice that wasn't ready.
const RETRY_MS = 4000;

// The header's "update available" badge state, read from GET /api/update-status (which the
// launcher fills in via ~/.mulmoterminal/update-status.json). Best-effort — any failure just
// leaves the badge hidden.
export function useUpdateStatus() {
  const notice = ref<string | null>(null);
  const badge = computed(() => parseUpdateNotice(notice.value));

  async function fetchOnce(): Promise<void> {
    try {
      const res = await fetch("/api/update-status");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.notice === "string") notice.value = data.notice;
    } catch {
      // best-effort — no badge is fine
    }
  }

  onMounted(async () => {
    await fetchOnce();
    if (!notice.value) setTimeout(() => void fetchOnce(), RETRY_MS);
  });

  return { badge };
}
