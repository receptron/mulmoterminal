import { ref, onMounted, onUnmounted } from "vue";
import { usePubSub } from "./usePubSub";

export interface Session {
  id: string;
  title: string;
  mtime: number;
  working: boolean;
  waiting: boolean;
  /** A hidden background worker (spawnBackgroundChat hidden:true) — listed, but
   *  never treated as unread/bold. */
  hidden?: boolean;
}

// "unread" = a session whose `waiting` flag is set, EXCEPT hidden background
// workers (mulmoclaude's unread, minus the background noise).
export type Filter = "all" | "unread";

/** A session that should draw the user's attention (bold + Unread filter): waiting
 *  for input, and not a hidden background worker. */
export function isUnread(s: Session): boolean {
  return !!s.waiting && !s.hidden;
}

// Merge a freshly-fetched list into the displayed one while keeping the order
// stable. The server sorts by recency (mtime), so a background update — e.g.
// switching away from a session bumps its file mtime — would reshuffle rows
// under the user and is disorienting. So: existing rows keep their position
// (only their data is refreshed), genuinely-new sessions are prepended (the
// server returns them newest-first), and vanished ones drop out. Callers that
// want a true recency re-sort pass `resort` (the ⟳ button).
export function mergeStable(prev: Session[], incoming: Session[], resort: boolean): Session[] {
  if (resort || prev.length === 0) return incoming;
  const incomingById = new Map(incoming.map((s) => [s.id, s]));
  const prevIds = new Set(prev.map((s) => s.id));
  const kept = prev.filter((s) => incomingById.has(s.id)).map((s) => incomingById.get(s.id) as Session);
  const added = incoming.filter((s) => !prevIds.has(s.id));
  return [...added, ...kept];
}

// Shared session-list state for both the vertical Sidebar and the horizontal
// SessionTabBar. Fetches the server's authoritative list and refetches on every
// "sessions" pub/sub push, merging it in without reordering existing rows.
export function useSessions() {
  const sessions = ref<Session[]>([]);
  const loading = ref(true);
  const error = ref<string | null>(null);

  async function load(resort = false) {
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      sessions.value = mergeStable(sessions.value, data.sessions ?? [], resort);
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

  // Explicit user action: re-sort the list by recency (server order).
  function refresh() {
    return load(true);
  }

  const { subscribe, onReconnect } = usePubSub();
  let unsubscribe: (() => void) | undefined;
  let offReconnect: (() => void) | undefined;

  onMounted(() => {
    load();
    unsubscribe = subscribe("sessions", () => load());
    // pub-sub replays room membership but not events missed while disconnected, so a
    // dropped socket can leave the list stale until the next push — refetch on reconnect.
    offReconnect = onReconnect(() => load());
  });
  onUnmounted(() => {
    unsubscribe?.();
    offReconnect?.();
  });

  return { sessions, loading, error, load, refresh };
}
