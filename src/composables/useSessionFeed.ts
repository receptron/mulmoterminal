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
  // The session id is not enough to tell two loads apart: switching away and back leaves two
  // in flight for the id that is current, so both pass the guard below. Only the newest may
  // apply — an older answer describes a moment already overtaken (#620).
  let latestLoad = 0;

  function upsert(item: T) {
    if (loadingSession !== null) arrivedDuringLoad.push(item);
    const id = identify(item);
    const index = id === undefined ? -1 : items.value.findIndex((existing) => identify(existing) === id);
    if (index >= 0) items.value[index] = item;
    else items.value = [...items.value, item];
  }

  async function loadHistory(id: string) {
    const loadId = ++latestLoad;
    loadingSession = id;
    arrivedDuringLoad = [];
    // A slow response for an old session must not clobber the pane after the user has
    // switched away — nor an older response for the session they switched back to.
    const overtaken = () => id !== sessionId() || loadId !== latestLoad;
    try {
      const res = await fetch(historyUrl(id));
      if (overtaken()) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (overtaken()) return;
      items.value = mergeLiveIntoSnapshot(data[historyKey] ?? [], arrivedDuringLoad, identify);
    } catch {
      // A failed history read must not take the live events with it.
      if (!overtaken()) items.value = mergeLiveIntoSnapshot([], arrivedDuringLoad, identify);
    } finally {
      // Only if a newer load has not already taken over the tracking. Comparing the load,
      // not the session id: switching back gives the newer load the same id as this one.
      if (loadId === latestLoad) {
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
