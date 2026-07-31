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
  /**
   * Fold an arriving item into the list by something OTHER than its identity, before the dedupe
   * below runs. Return "skip" to drop it; mutate `items` to remove what it supersedes.
   *
   * Exists for a pair the identity cannot relate: a browser-seeded collection placeholder and the
   * agent's real card for the same collection are one thing rendered twice, but they are written
   * by different sources and so never share a uuid. The server applies the same rule to what it
   * stores; this is the live half, for the panel already on screen.
   */
  reconcile?: Reconcile<T>;
}

type Reconcile<T> = (items: T[], incoming: T) => "store" | "skip";

/**
 * A fetched snapshot plus what arrived while it was in flight, with any `reconcile` rule applied.
 *
 * The identity merge alone is not enough once a rule is in play: the pair it relates has two
 * different identities, so the merge can put back an item the live path already superseded — and
 * the mirror case is just as real, a snapshot READ before the newer item was stored still holding
 * the one it replaces. Replaying the rule over the merged list, in arrival order, is the same fold
 * the live path does one item at a time, so both directions settle to the same answer.
 */
function mergeSettled<T>(snapshot: readonly T[], buffered: readonly T[], identify: (item: T) => string | undefined, reconcile?: Reconcile<T>): T[] {
  const merged = mergeLiveIntoSnapshot(snapshot, buffered, identify);
  if (!reconcile) return merged;
  const settled: T[] = [];
  for (const item of merged) if (reconcile(settled, item) === "store") settled.push(item);
  return settled;
}

export function useSessionFeed<T>(items: Ref<T[]>, options: SessionFeedOptions<T>) {
  const { sessionId, historyUrl, historyKey, channel, identify, onSessionChange, reconcile } = options;

  // What the live channel delivered while a history request was in flight. The response is
  // authoritative as of when it was SENT, so these have to survive it (#620 F1).
  let loadingSession: string | null = null;
  let arrivedDuringLoad: T[] = [];
  // The session id is not enough to tell two loads apart: switching away and back leaves two
  // in flight for the id that is current, so both pass the guard below. Only the newest may
  // apply — an older answer describes a moment already overtaken (#620).
  let latestLoad = 0;

  function upsert(item: T) {
    // Over a copy, assigned back: the callback removes what `item` supersedes, and a splice on the
    // ref's own array would leave the list mutated whether or not the item is then stored.
    const next = reconcile ? [...items.value] : items.value;
    const verdict = reconcile ? reconcile(next, item) : "store";
    items.value = next;
    // Buffered only if it survived: the buffer is replayed when the history lands, so an item
    // dropped here and left in it would come straight back (Codex, PR #1186).
    if (loadingSession !== null && verdict === "store") arrivedDuringLoad.push(item);
    if (verdict === "skip") return;
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
      items.value = mergeSettled(data[historyKey] ?? [], arrivedDuringLoad, identify, reconcile);
    } catch {
      // A failed history read must not take the live events with it.
      if (!overtaken()) items.value = mergeSettled([], arrivedDuringLoad, identify, reconcile);
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
