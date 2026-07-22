import { describe, it, expect } from "vitest";

import { applyLiveTouches, mergeLiveIntoSnapshot, snapshotAppliesTo } from "../../../src/composables/liveMerge";

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

describe("applyLiveTouches", () => {
  const entry = (id: string, text = id) => ({ id, text });
  const byId = (item: { id: string }) => item.id;

  it("is the snapshot when nothing happened meanwhile", () => {
    const snapshot = [entry("a")];
    expect(applyLiveTouches(snapshot, new Map(), byId)).toEqual(snapshot);
  });

  // The bug this exists for (#620 F2): the fetch went out while the notification still
  // existed, so the response still lists it — applied wholesale, the bell re-lights for
  // something the user already dismissed.
  it("keeps a dismissed item dismissed", () => {
    const touched = new Map([["a", { kind: "remove" as const }]]);
    expect(applyLiveTouches([entry("a"), entry("b")], touched, byId).map(byId)).toEqual(["b"]);
  });

  // The other direction: one published mid-flight is absent from the response.
  it("keeps an item published while the fetch was in flight", () => {
    const touched = new Map([["new", { kind: "upsert" as const, item: entry("new") }]]);
    expect(applyLiveTouches([entry("a")], touched, byId).map(byId)).toEqual(["a", "new"]);
  });

  it("lets a live update win over the snapshot's copy", () => {
    const touched = new Map([["a", { kind: "upsert" as const, item: entry("a", "newer") }]]);
    expect(applyLiveTouches([entry("a", "older")], touched, byId)).toEqual([{ id: "a", text: "newer" }]);
  });

  it("updates in place rather than moving the item to the end", () => {
    const touched = new Map([["a", { kind: "upsert" as const, item: entry("a", "newer") }]]);
    expect(applyLiveTouches([entry("a"), entry("b")], touched, byId).map(byId)).toEqual(["a", "b"]);
  });

  it("handles a removal and an addition in the same flight", () => {
    const touched = new Map<string, { kind: "remove" } | { kind: "upsert"; item: { id: string; text: string } }>([
      ["a", { kind: "remove" }],
      ["c", { kind: "upsert", item: entry("c") }],
    ]);
    expect(applyLiveTouches([entry("a"), entry("b")], touched, byId).map(byId)).toEqual(["b", "c"]);
  });

  // Dismissing something the snapshot never had must not resurrect it as an addition.
  it("does not re-add an item that was removed and is absent from the snapshot", () => {
    const touched = new Map([["gone", { kind: "remove" as const }]]);
    expect(applyLiveTouches([entry("a")], touched, byId).map(byId)).toEqual(["a"]);
  });

  it("does not mutate the snapshot", () => {
    const snapshot = [entry("a")];
    applyLiveTouches(snapshot, new Map([["a", { kind: "remove" as const }]]), byId);
    expect(snapshot.map(byId)).toEqual(["a"]);
  });
});

describe("snapshotAppliesTo", () => {
  it("lets a snapshot speak for an id nothing has touched since", () => {
    expect(snapshotAppliesTo("s1", new Set())).toBe(true);
  });

  // The bug this exists for (#620 F3): a working cell blinks to idle when a seed response
  // lands after a live event, and stays wrong until the next event happens to arrive.
  it("refuses a snapshot for an id the live channel already spoke for", () => {
    expect(snapshotAppliesTo("s1", new Set(["s1"]))).toBe(false);
  });

  it("judges each id on its own", () => {
    const touched = new Set(["s1"]);
    expect([snapshotAppliesTo("s1", touched), snapshotAppliesTo("s2", touched)]).toEqual([false, true]);
  });
});
