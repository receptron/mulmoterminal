import { describe, it, expect } from "vitest";
import { parseUpdateNotice } from "../../../src/composables/updateNotice";

describe("parseUpdateNotice", () => {
  it("is null when there is no notice", () => {
    expect(parseUpdateNotice(null)).toBeNull();
    expect(parseUpdateNotice(undefined)).toBeNull();
    expect(parseUpdateNotice("")).toBeNull();
  });

  // The command after "run: " is pulled out so the badge can copy just that.
  it("pulls the npm command out of the notice", () => {
    const badge = parseUpdateNotice("Update available: 0.7.1 → 0.8.0  ·  run: npm i -g mulmoterminal");
    expect(badge).toEqual({
      text: "Update available: 0.7.1 → 0.8.0  ·  run: npm i -g mulmoterminal",
      command: "npm i -g mulmoterminal",
    });
  });

  it("pulls the git command out of the notice", () => {
    expect(parseUpdateNotice("Update available: a1b2c3d → origin  ·  run: git pull")?.command).toBe("git pull");
  });

  // A notice without the marker still shows (as the tooltip); there is just nothing to copy.
  it("keeps the text but has no command when there is no run marker", () => {
    expect(parseUpdateNotice("A new version is out")).toEqual({ text: "A new version is out", command: null });
  });
});
