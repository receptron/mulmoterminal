// A session-scoped live list: history is replayed from an endpoint whenever the
// active session changes, then pushes on that session's pub/sub channel are merged
// in, deduped by each item's identity (a re-emitted item updates in place).
import { onUnmounted, watch, type Ref } from "vue";
import { usePubSub } from "./usePubSub";
import { mergeSnapshotWithLive } from "./snapshotMerge";

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

  // Non-null while a history load is in flight, collecting what the live channel delivers
  // meanwhile — the history answers as of the moment it was REQUESTED, so those items are
  // newer than it and must survive being applied (#620 F1).
  let arrivedDuringLoad: T[] | null = null;
  // Loads overlap when the session changes and changes back, so the guard below is not
  // enough on its own: both requests are for the id that is current. Only the newest answer
  // may be applied — an older one describes a moment already overtaken.
  let latestLoad = 0;

  function upsert(item: T) {
    arrivedDuringLoad?.push(item);
    const id = identify(item);
    const index = id === undefined ? -1 : items.value.findIndex((existing) => identify(existing) === id);
    if (index >= 0) items.value[index] = item;
    else items.value = [...items.value, item];
  }

  async function loadHistory(id: string) {
    const loadId = ++latestLoad;
    const live: T[] = [];
    arrivedDuringLoad = live;
    const overtaken = () => id !== sessionId() || loadId !== latestLoad;
    try {
      const res = await fetch(historyUrl(id));
      // Guard against a session-switch race: a slow response for an old session must
      // not clobber the pane after the user has switched to a newer one.
      if (overtaken()) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (overtaken()) return;
      items.value = mergeSnapshotWithLive(data[historyKey] ?? [], live, identify);
    } catch {
      // No history to show, but an event that arrived while asking is still this session's.
      // A load that has been overtaken leaves the list to the one that overtook it.
      if (!overtaken()) items.value = [...live];
    } finally {
      // A newer load has taken over: leave its buffer alone.
      if (arrivedDuringLoad === live) arrivedDuringLoad = null;
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
