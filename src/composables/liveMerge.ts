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

// The same race, for a list the live channel can also REMOVE from.
//
// A dismissed notification is the case that matters: the fetch went out while it still
// existed, so the response still lists it, and applying that wholesale brings it BACK — the
// bell re-lights for something the user already dealt with. The reverse happens too: one
// published mid-flight is absent from the response and would disappear.
export type LiveTouch<T> = { kind: "upsert"; item: T } | { kind: "remove" };

export function applyLiveTouches<T>(snapshot: readonly T[], touched: ReadonlyMap<string, LiveTouch<T>>, identify: (item: T) => string): T[] {
  if (touched.size === 0) return [...snapshot];
  const merged = snapshot
    .filter((item) => touched.get(identify(item))?.kind !== "remove")
    .map((item) => {
      const touch = touched.get(identify(item));
      return touch?.kind === "upsert" ? touch.item : item;
    });
  const known = new Set(merged.map(identify));
  // Anything the live channel added that the snapshot predates.
  for (const [id, touch] of touched) {
    if (touch.kind === "upsert" && !known.has(id)) merged.push(touch.item);
  }
  return merged;
}

// The map shape of the same race: which ids a snapshot may still speak for.
//
// A response about a set of sessions is authoritative as of when it was SENT. An id the live
// channel has touched since then is newer, so applying the snapshot to it walks the cell
// backwards — a working cell blinks to idle until the next event happens to arrive.
export function snapshotAppliesTo(id: string, touchedSince: ReadonlySet<string>): boolean {
  return !touchedSince.has(id);
}
