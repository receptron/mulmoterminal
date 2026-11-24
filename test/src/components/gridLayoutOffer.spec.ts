import { describe, it, expect } from "vitest";
import { cellsToOffer } from "../../../src/components/gridLayoutOffer";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const layout = {
  cells: [
    { uid: 4, session: A, cwd: "/a" },
    { uid: 7, session: B, cwd: "/b", agent: "codex" },
    { uid: 9, session: C, cwd: null, launcher: { kind: "shell" } },
    { uid: 10, session: null, cwd: "/launch-form" },
  ],
  page: 0,
};

describe("cellsToOffer", () => {
  it("offers every session cell the copy held, in its order, as a cell to place", () => {
    const cells = cellsToOffer(layout, [], []);
    expect(cells.map((c) => c.session)).toEqual([A, B, C]);
    expect(cells[1]).toMatchObject({ session: B, cwd: "/b", agent: "codex" });
    expect(cells.every((c) => !("uid" in c))).toBe(true);
  });

  it("leaves out a cell already here and one another tab is showing", () => {
    expect(cellsToOffer(layout, [A], [C]).map((c) => c.session)).toEqual([B]);
  });

  // Read the way the browser's own copy is read, so a cell it would drop is not offered either.
  it("leaves out a cell whose session is not a UUID", () => {
    expect(cellsToOffer({ cells: [{ uid: 0, session: "mt-undefined", cwd: "/x" }] }, [], [])).toEqual([]);
  });

  it.each([null, undefined, {}, { cells: "x" }, [1], "text"])("offers nothing for %j", (value) => {
    expect(cellsToOffer(value, [], [])).toEqual([]);
  });
});
