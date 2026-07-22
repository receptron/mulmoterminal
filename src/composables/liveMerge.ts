// Applying a fetched snapshot without discarding what arrived while it was in flight.
//
// A response carries the authoritative state as of when the REQUEST was sent, not as of when
// it came back. Applied as the latter, it silently undoes everything pub/sub delivered in
// between — a tool call that fired during a session switch vanishes from the pane and does
// not come back until a reload.
//
// The rule: the snapshot supplies the baseline, and anything the live channel touched since
// the request went out wins over it. An item the snapshot has never heard of is kept, not
// dropped — it is newer than the snapshot, not older.

// Items whose identity cannot be determined can't be matched against the snapshot, so they
// are appended — the same thing the live path does when it cannot find them.
export function mergeLiveIntoSnapshot<T>(snapshot: readonly T[], arrivedSince: readonly T[], identify: (item: T) => string | undefined): T[] {
  if (arrivedSince.length === 0) return [...snapshot];
  const merged = [...snapshot];
  for (const item of arrivedSince) {
    const id = identify(item);
    const at = id === undefined ? -1 : merged.findIndex((existing) => identify(existing) === id);
    if (at >= 0) merged[at] = item;
    else merged.push(item);
  }
  return merged;
}

// Some lists lose entries while a snapshot is in flight, not just gain them: the bell's list
// is fetched whole while the channel is clearing entries out of it. A merge that only knows
// about arrivals hands a dismissed notification straight back (#620 F2).
export type LiveChange<T> = { kind: "upsert"; item: T } | { kind: "remove"; id: string };

// Replayed IN ORDER, because the order is the answer: publish-then-clear leaves nothing,
// clear-then-publish leaves the item, and a set of touched ids could not tell them apart.
export function applyLiveChanges<T>(snapshot: readonly T[], changes: readonly LiveChange<T>[], identify: (item: T) => string | undefined): T[] {
  const merged = [...snapshot];
  for (const change of changes) {
    if (change.kind === "remove") {
      const at = merged.findIndex((existing) => identify(existing) === change.id);
      if (at >= 0) merged.splice(at, 1);
      continue;
    }
    const id = identify(change.item);
    const at = id === undefined ? -1 : merged.findIndex((existing) => identify(existing) === id);
    if (at >= 0) merged[at] = change.item;
    else merged.push(change.item);
  }
  return merged;
}
