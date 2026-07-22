// A session-scoped live list: history is replayed from an endpoint whenever the
// active session changes, then pushes on that session's pub/sub channel are merged
// in, deduped by each item's identity (a re-emitted item updates in place).
import { onUnmounted, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";

interface SessionFeedOptions<T> {
  sessionId: () => string | null;
  historyUrl: (id: string) => string;
  historyKey: string;
  channel: (id: string) => string;
  identify: (item: T) => string | undefined;
  onSessionChange?: () => void;
}

export function useSessionFeed<T>(items: Ref<T[]>, options: SessionFeedOptions<T>) {
  const { sessionId, historyUrl, historyKey, channel, identify, onSessionChange } = options;

  function upsert(item: T) {
    const id = identify(item);
    const index = id === undefined ? -1 : items.value.findIndex((existing) => identify(existing) === id);
    if (index >= 0) items.value[index] = item;
    else items.value = [...items.value, item];
  }

  async function loadHistory(id: string) {
    try {
      const res = await fetch(historyUrl(id));
      // Guard against a session-switch race: a slow response for an old session must
      // not clobber the pane after the user has switched to a newer one.
      if (id !== sessionId()) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (id !== sessionId()) return;
      items.value = data[historyKey] ?? [];
    } catch {
      if (id === sessionId()) items.value = [];
    }
  }

  const { subscribe } = usePubSub();
  let unsubscribe: (() => void) | undefined;

  function subscribeTo(id: string | null) {
    unsubscribe?.();
    unsubscribe = undefined;
    if (!id) return;
    unsubscribe = subscribe(channel(id), (data) => upsert(data as T));
  }

  watch(
    sessionId,
    (id) => {
      onSessionChange?.();
      if (id) loadHistory(id);
      else items.value = [];
      subscribeTo(id);
    },
    { immediate: true },
  );

  onUnmounted(() => unsubscribe?.());

  return { upsert };
}
