// A session-scoped live list: history is replayed from an endpoint whenever the
// active session changes, then pushes on that session's pub/sub channel are merged
// in, deduped by each item's identity (a re-emitted item updates in place).
import { onUnmounted, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { mergeLiveIntoSnapshot } from "./liveMerge";

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

  // What the live channel delivered while a history request was in flight. The response is
  // authoritative as of when it was SENT, so these have to survive it (#620 F1).
  let loadingSession: string | null = null;
  let arrivedDuringLoad: T[] = [];

  function upsert(item: T) {
    if (loadingSession !== null) arrivedDuringLoad.push(item);
    const id = identify(item);
    const index = id === undefined ? -1 : items.value.findIndex((existing) => identify(existing) === id);
    if (index >= 0) items.value[index] = item;
    else items.value = [...items.value, item];
  }

  async function loadHistory(id: string) {
    loadingSession = id;
    arrivedDuringLoad = [];
    try {
      const res = await fetch(historyUrl(id));
      // Guard against a session-switch race: a slow response for an old session must
      // not clobber the pane after the user has switched to a newer one.
      if (id !== sessionId()) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (id !== sessionId()) return;
      items.value = mergeLiveIntoSnapshot(data[historyKey] ?? [], arrivedDuringLoad, identify);
    } catch {
      // A failed history read must not take the live events with it.
      if (id === sessionId()) items.value = mergeLiveIntoSnapshot([], arrivedDuringLoad, identify);
    } finally {
      // Only if a newer load has not already taken over the tracking.
      if (loadingSession === id) {
        loadingSession = null;
        arrivedDuringLoad = [];
      }
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
