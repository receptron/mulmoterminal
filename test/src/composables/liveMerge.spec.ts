import { describe, it, expect } from "vitest";

import { mergeLiveIntoSnapshot, applyLiveChanges } from "../../../src/composables/liveMerge";

interface Item {
  id?: string;
  text: string;
}
const identify = (item: Item) => item.id;

describe("mergeLiveIntoSnapshot", () => {
  it("is the snapshot when nothing arrived meanwhile", () => {
    const snapshot = [{ id: "a", text: "A" }];
    expect(mergeLiveIntoSnapshot(snapshot, [], identify)).toEqual(snapshot);
  });

  // The bug this exists for (#620 F1): a tool call that fires during a session switch used
  // to vanish when the history response landed, and not come back until a reload.
  it("keeps an item the snapshot has never heard of", () => {
    const merged = mergeLiveIntoSnapshot([{ id: "a", text: "A" }], [{ id: "b", text: "B" }], identify);
    expect(merged).toEqual([
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ]);
  });

  // The live value is newer than the snapshot by definition — the request was sent first.
  it("lets a live update win over the snapshot's copy", () => {
    const merged = mergeLiveIntoSnapshot([{ id: "a", text: "old" }], [{ id: "a", text: "new" }], identify);
    expect(merged).toEqual([{ id: "a", text: "new" }]);
  });

  it("updates in place rather than appending a duplicate", () => {
    const merged = mergeLiveIntoSnapshot(
      [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      [{ id: "a", text: "A2" }],
      identify,
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("keeps the snapshot's order and appends new arrivals after it", () => {
    const merged = mergeLiveIntoSnapshot(
      [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      [
        { id: "c", text: "C" },
        { id: "d", text: "D" },
      ],
      identify,
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("applies several updates to the same item in arrival order", () => {
    const merged = mergeLiveIntoSnapshot(
      [{ id: "a", text: "old" }],
      [
        { id: "a", text: "mid" },
        { id: "a", text: "new" },
      ],
      identify,
    );
    expect(merged).toEqual([{ id: "a", text: "new" }]);
  });

  // An empty snapshot is what a FAILED history read supplies — the live events must still
  // survive it, rather than the pane going blank.
  it("keeps live arrivals when the snapshot is empty", () => {
    expect(mergeLiveIntoSnapshot([], [{ id: "a", text: "A" }], identify)).toEqual([{ id: "a", text: "A" }]);
  });

  // Unidentifiable items cannot be matched, so they are appended — the same thing the live
  // path does when it cannot find them.
  it("appends items with no identity rather than dropping them", () => {
    const merged = mergeLiveIntoSnapshot([{ text: "S" }], [{ text: "L1" }, { text: "L2" }], identify);
    expect(merged.map((i) => i.text)).toEqual(["S", "L1", "L2"]);
  });

  it("does not mutate either input", () => {
    const snapshot = [{ id: "a", text: "A" }];
    const arrived = [{ id: "a", text: "A2" }];
    mergeLiveIntoSnapshot(snapshot, arrived, identify);
    expect(snapshot).toEqual([{ id: "a", text: "A" }]);
    expect(arrived).toEqual([{ id: "a", text: "A2" }]);
  });
});

// The bell's list loses entries while it is being fetched, not just gains them, so what is
// recorded is what the channel DID — in order (#620 F2).
describe("applyLiveChanges", () => {
  interface Row {
    id: string;
    text: string;
  }
  const identify = (row: Row) => row.id;
  const SNAPSHOT: Row[] = [
    { id: "a", text: "first" },
    { id: "b", text: "second" },
  ];
  const texts = (rows: Row[]) => rows.map((row) => row.text);

  it("keeps the snapshot when nothing happened", () => {
    expect(applyLiveChanges(SNAPSHOT, [], identify)).toEqual(SNAPSHOT);
  });

  it("drops an entry removed while the snapshot was in flight", () => {
    expect(texts(applyLiveChanges(SNAPSHOT, [{ kind: "remove", id: "a" }], identify))).toEqual(["second"]);
  });

  it("ignores a removal for something the snapshot never had", () => {
    expect(applyLiveChanges(SNAPSHOT, [{ kind: "remove", id: "zzz" }], identify)).toEqual(SNAPSHOT);
  });

  it("adds an entry that arrived while the snapshot was in flight", () => {
    expect(texts(applyLiveChanges(SNAPSHOT, [{ kind: "upsert", item: { id: "c", text: "third" } }], identify))).toEqual(["first", "second", "third"]);
  });

  it("updates in place", () => {
    expect(texts(applyLiveChanges(SNAPSHOT, [{ kind: "upsert", item: { id: "a", text: "first, updated" } }], identify))).toEqual(["first, updated", "second"]);
  });

  // Order is the whole point: a set of touched ids could not tell these two apart.
  it("leaves nothing when an entry was added and then removed", () => {
    const changes = [
      { kind: "upsert" as const, item: { id: "c", text: "third" } },
      { kind: "remove" as const, id: "c" },
    ];
    expect(applyLiveChanges(SNAPSHOT, changes, identify)).toEqual(SNAPSHOT);
  });

  it("keeps the entry when it was removed and then added again", () => {
    const changes = [
      { kind: "remove" as const, id: "a" },
      { kind: "upsert" as const, item: { id: "a", text: "first, again" } },
    ];
    expect(texts(applyLiveChanges(SNAPSHOT, changes, identify))).toEqual(["second", "first, again"]);
  });
});
