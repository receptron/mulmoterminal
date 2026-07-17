import { describe, it, expect } from "vitest";
import { repoFromWebUrl } from "../../server/../server/header-context.js";

describe("repoFromWebUrl", () => {
  it("extracts owner/repo from a github web url", () => {
    expect(repoFromWebUrl("https://github.com/receptron/mulmoterminal")).toBe("receptron/mulmoterminal");
  });
  it("strips a trailing .git and slashes", () => {
    expect(repoFromWebUrl("https://github.com/o/r.git")).toBe("o/r");
    expect(repoFromWebUrl("https://github.com/o/r/")).toBe("o/r");
  });
  it("returns null for a null input or a non-github url", () => {
    expect(repoFromWebUrl(null)).toBeNull();
    expect(repoFromWebUrl("https://gitlab.com/o/r")).toBeNull();
  });
});
