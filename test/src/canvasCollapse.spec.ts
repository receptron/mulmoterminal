import { describe, it, expect } from "vitest";
import { collapseByIdentity } from "../../src/utils/canvasCollapse";

// The Canvas rule: a thing drawn twice appears once, as its newest drawing, at that drawing's
// position. See src/utils/canvasCollapse.ts — the "at that drawing's position" half is a
// deliberate divergence from MulmoClaude and is pinned here rather than left to the reader.

interface Card {
  uuid: string;
  id: string | null;
}
const card = (uuid: string, id: string | null): Card => ({ uuid, id });
const identity = (c: Card) => c.id;
const uuids = (list: Card[]) => list.map((c) => c.uuid);

describe("collapseByIdentity", () => {
  it("keeps a list with no repeats exactly as it is", () => {
    const list = [card("a", "doc"), card("b", "html"), card("c", "coll")];
    expect(collapseByIdentity(list, identity)).toEqual(list);
  });

  it("keeps only the newest of a repeated identity", () => {
    const list = [card("a1", "coll"), card("a2", "coll"), card("a3", "coll")];
    expect(uuids(collapseByIdentity(list, identity))).toEqual(["a3"]);
  });

  it("moves the survivor to the newest occurrence's position, not the first", () => {
    // The whole point of the divergence: MulmoClaude would leave the merged card at index 0,
    // where nothing signals that it just changed. Here it lands last, which is where the panel's
    // auto-follow scrolls to.
    const list = [card("a1", "coll"), card("b", "doc"), card("a2", "coll")];
    expect(uuids(collapseByIdentity(list, identity))).toEqual(["b", "a2"]);
  });

  it("collapses non-adjacent repeats, not just consecutive ones", () => {
    const list = [card("a1", "coll"), card("b1", "doc"), card("a2", "coll"), card("b2", "doc"), card("a3", "coll")];
    expect(uuids(collapseByIdentity(list, identity))).toEqual(["b2", "a3"]);
  });

  it("never collapses a null identity, however many there are", () => {
    // A tool that has not opted in — and inline content, which has nothing durable behind it —
    // must behave exactly as before this existed.
    const list = [card("a", null), card("b", null), card("c", null)];
    expect(uuids(collapseByIdentity(list, identity))).toEqual(["a", "b", "c"]);
  });

  it("collapses identified cards while leaving unidentified ones interleaved in place", () => {
    const list = [card("x1", null), card("a1", "coll"), card("x2", null), card("a2", "coll")];
    expect(uuids(collapseByIdentity(list, identity))).toEqual(["x1", "x2", "a2"]);
  });

  it("keeps distinct identities apart", () => {
    const list = [card("a1", "one"), card("b1", "two"), card("a2", "one")];
    expect(uuids(collapseByIdentity(list, identity))).toEqual(["b1", "a2"]);
  });

  it("returns a new array and does not mutate its input", () => {
    // The caller is a computed over a ref's array; reversing in place would corrupt the feed.
    const list = [card("a1", "coll"), card("a2", "coll")];
    const before = [...list];
    collapseByIdentity(list, identity);
    expect(list).toEqual(before);
  });

  it("handles an empty list", () => {
    expect(collapseByIdentity([], identity)).toEqual([]);
  });
});
