import { ref, onMounted, onUnmounted } from "vue";
import { usePubSub } from "./usePubSub";

export interface Session {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
}

// Shared session-list state for both the vertical Sidebar and the horizontal
// SessionTabBar. Fetches the server's authoritative list and refetches on every
// "sessions" pub/sub push — no client-side bookkeeping about what changed.
export function useSessions() {
  const sessions = ref<Session[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      sessions.value = data.sessions ?? [];
      error.value = null;
    } catch (e) {
      // load() runs on every pub/sub push; a transient refetch failure must not
      // replace an already-populated list with an error banner. Only surface the
      // error when we have nothing to show yet.
      if (sessions.value.length === 0) {
        error.value = e instanceof Error ? e.message : String(e);
      }
    } finally {
      // Only the first load shows the "Loading…" state; later refreshes are
      // silent so the list doesn't flicker.
      loading.value = false;
    }
  }

  const { subscribe } = usePubSub();
  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    load();
    unsubscribe = subscribe("sessions", () => load());
  });
  onUnmounted(() => unsubscribe?.());

  return { sessions, loading, error, load };
}
