import { describe, it, expect } from "vitest";

import { mergeSnapshotWithLive } from "../../../src/composables/snapshotMerge";

interface Row {
  id?: string;
  text: string;
}

const identify = (row: Row) => row.id;
const texts = (rows: Row[]) => rows.map((row) => row.text);

const HISTORY: Row[] = [
  { id: "a", text: "first" },
  { id: "b", text: "second" },
  { id: "c", text: "third" },
];

describe("mergeSnapshotWithLive", () => {
  it("keeps the snapshot as-is when nothing arrived meanwhile", () => {
    expect(mergeSnapshotWithLive(HISTORY, [], identify)).toEqual(HISTORY);
  });

  // The case the merge exists for: the event fired after the request went out, so the
  // history could not contain it, and replacing wholesale used to erase it.
  it("keeps an item the snapshot could not have known about", () => {
    const live = [{ id: "d", text: "arrived while loading" }];
    expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toEqual(["first", "second", "third", "arrived while loading"]);
  });

  it("puts a newer item after the snapshot, not before it", () => {
    const live = [{ id: "d", text: "newest" }];
    expect(mergeSnapshotWithLive(HISTORY, live, identify).at(-1)?.text).toBe("newest");
  });

  describe("when a live item is a newer version of a row the snapshot has", () => {
    const live = [{ id: "b", text: "second, updated" }];

    it("takes the live version", () => {
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toContain("second, updated");
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).not.toContain("second");
    });

    it("leaves it where the snapshot had it", () => {
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toEqual(["first", "second, updated", "third"]);
    });

    it("does not also append it", () => {
      expect(mergeSnapshotWithLive(HISTORY, live, identify)).toHaveLength(3);
    });

    it("updates the first row without disturbing the rest", () => {
      const updateFirst = [{ id: "a", text: "first, updated" }];
      expect(texts(mergeSnapshotWithLive(HISTORY, updateFirst, identify))).toEqual(["first, updated", "second", "third"]);
    });
  });

  describe("several live items", () => {
    it("appends them in arrival order", () => {
      const live = [
        { id: "d", text: "d" },
        { id: "e", text: "e" },
      ];
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toEqual(["first", "second", "third", "d", "e"]);
    });

    it("mixes updates and additions without losing either", () => {
      const live = [
        { id: "b", text: "second, updated" },
        { id: "d", text: "new" },
      ];
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toEqual(["first", "second, updated", "third", "new"]);
    });

    // A tool call is re-emitted as it progresses, so the same id arrives more than once.
    it("keeps only the last version of a repeated item", () => {
      const live = [
        { id: "d", text: "running" },
        { id: "d", text: "done" },
      ];
      const merged = mergeSnapshotWithLive(HISTORY, live, identify);
      expect(texts(merged)).toEqual(["first", "second", "third", "done"]);
      expect(merged).toHaveLength(4);
    });

    it("keeps only the last version when it updates a snapshot row too", () => {
      const live = [
        { id: "b", text: "running" },
        { id: "b", text: "done" },
      ];
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toEqual(["first", "done", "third"]);
    });
  });

  describe("empty cases", () => {
    it("returns the live items when there is no history", () => {
      const live = [{ id: "a", text: "only" }];
      expect(mergeSnapshotWithLive([], live, identify)).toEqual(live);
    });

    it("returns nothing when both are empty", () => {
      expect(mergeSnapshotWithLive([], [], identify)).toEqual([]);
    });
  });

  // An item the caller cannot identify cannot be matched, so it can only be appended —
  // dropping it would lose the event the merge exists to keep.
  describe("items with no identity", () => {
    it("keeps an unidentifiable live item", () => {
      const live = [{ text: "no id" }];
      expect(texts(mergeSnapshotWithLive(HISTORY, live, identify))).toEqual(["first", "second", "third", "no id"]);
    });

    it("keeps unidentifiable snapshot rows where they were", () => {
      const snapshot = [{ text: "no id" }, { id: "a", text: "first" }];
      expect(texts(mergeSnapshotWithLive(snapshot, [], identify))).toEqual(["no id", "first"]);
    });

    it("never matches two unidentifiable items to each other", () => {
      const snapshot = [{ text: "snapshot one" }];
      const live = [{ text: "live one" }];
      expect(texts(mergeSnapshotWithLive(snapshot, live, identify))).toEqual(["snapshot one", "live one"]);
    });
  });
});
