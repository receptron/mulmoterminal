// #2622. Row keys follow the chip, not its place, and the add menu offers only built-ins not shown.
import { describe, it, expect } from "vitest";
import { addableBuiltins, chipRows } from "../../../../src/components/settings/headerChipsEditing";

describe("chipRows", () => {
  it("keeps a chip's key when it moves, and tells repeated chips apart", () => {
    const custom = { label: "a", text: "b" };
    const before = chipRows(["git", custom, custom]).map((row) => row.key);
    const after = chipRows([custom, "git", custom]).map((row) => row.key);
    expect(new Set(before).size).toBe(3);
    expect(after[1]).toBe(before[0]);
    expect(new Set(after)).toEqual(new Set(before));
  });
});

describe("addableBuiltins", () => {
  it("offers what the list does not show, reading unconfigured as the default set", () => {
    expect(addableBuiltins(null)).toEqual([]);
    expect(addableBuiltins([])).toEqual(["git", "work", "diff", "ctx", "usage", "env", "peer"]);
    expect(addableBuiltins(["ctx", { label: "git", text: "x" }])).toEqual(["git", "work", "diff", "usage", "env", "peer"]);
  });
});
