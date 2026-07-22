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
