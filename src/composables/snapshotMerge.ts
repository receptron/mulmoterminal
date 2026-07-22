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

// What the live channel did while the snapshot was in flight. Removals have to travel too:
// a list that only knows about additions would hand back something the user has already
// dismissed (#620 F2).
export type LiveChange<T> = { kind: "upsert"; item: T } | { kind: "remove"; id: string };

// Replayed IN ORDER, because the order is the answer: publish-then-clear leaves nothing,
// clear-then-publish leaves the item, and a set of ids could not tell the two apart.
export function applyLiveChanges<T>(snapshot: readonly T[], changes: readonly LiveChange<T>[], identify: (item: T) => string | undefined): T[] {
  const rows = [...snapshot];
  for (const change of changes) {
    if (change.kind === "remove") {
      const index = rows.findIndex((row) => identify(row) === change.id);
      if (index >= 0) rows.splice(index, 1);
      continue;
    }
    const id = identify(change.item);
    // An item the caller cannot identify can't be matched, so it can only be appended —
    // dropping it would lose the very event this exists to keep.
    const index = id === undefined ? -1 : rows.findIndex((row) => identify(row) === id);
    if (index >= 0) rows[index] = change.item;
    else rows.push(change.item);
  }
  return rows;
}

export function mergeSnapshotWithLive<T>(snapshot: readonly T[], live: readonly T[], identify: (item: T) => string | undefined): T[] {
  return applyLiveChanges(
    snapshot,
    live.map((item) => ({ kind: "upsert" as const, item })),
    identify,
  );
}
