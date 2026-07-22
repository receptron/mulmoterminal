// Reconciling an authoritative snapshot with whatever the live channel delivered while that
// snapshot was being fetched.
//
// A GET answers with the state as of when the request WENT OUT, not as of when it came back.
// Applying it as the latter is what erases an event that arrived in between: in the tools
// pane, a tool call that fired just as the session was selected vanishes and does not come
// back until the pane reloads its history (#620 F1).
//
// The snapshot keeps its order — it is the server's, and it is what the list looked like.
// A live item replaces its counterpart IN PLACE, because it is the newer version of the
// same row; one with no counterpart is newer than the whole snapshot and goes at the end.

export function mergeSnapshotWithLive<T>(snapshot: readonly T[], live: readonly T[], identify: (item: T) => string | undefined): T[] {
  const liveById = new Map<string, T>();
  // An item the caller cannot identify can't be matched against the snapshot, so it can only
  // be appended — dropping it would lose the very event this merge exists to keep.
  const unidentified: T[] = [];
  live.forEach((item) => {
    const id = identify(item);
    if (id === undefined) unidentified.push(item);
    else liveById.set(id, item); // a re-emitted item updates in place, last wins
  });

  const merged = snapshot.map((item) => {
    const id = identify(item);
    if (id === undefined) return item;
    const fresher = liveById.get(id);
    if (fresher === undefined) return item;
    liveById.delete(id); // taken: it must not also be appended
    return fresher;
  });
  return [...merged, ...liveById.values(), ...unidentified];
}
