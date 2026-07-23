import { describe, it, expect } from "vitest";

import { shortPkg } from "../../../src/components/shortPkg";

describe("shortPkg", () => {
  it.each([
    ["@receptron/mulmocast", "mulmocast"],
    ["@scope/foo/bar", "foo/bar"],
    ["mulmocast", "mulmocast"],
    ["", ""],
  ])("shortens %j to %j", (input, expected) => {
    expect(shortPkg(input)).toBe(expected);
  });

  // A bare scope has nothing after the slash; collapsing to "" would blank the source,
  // so the original is kept instead.
  it("keeps a bare @scope/ rather than returning empty", () => {
    expect(shortPkg("@scope/")).toBe("@scope/");
  });
});
