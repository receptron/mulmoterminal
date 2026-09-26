import { describe, it, expect } from "vitest";
import { pathWithinCwd, rebaseOutsideCwd } from "../../../src/composables/pathWithinCwd";

// #910. This is the gate that decides whether a clicked path can open in the pane beside an
// enlarged cell — the pane is rooted at that cell's directory and cannot walk above it. A
// wrong `null` costs the user nothing (the click keeps its old route); a wrong path opens
// somebody else's file, so the interesting cases are the ones that LOOK contained.
describe("pathWithinCwd", () => {
  const CWD = "/Users/me/proj";

  it.each([
    ["a relative path", "src/main.ts", "src/main.ts"],
    ["an explicitly-relative path", "./src/main.ts", "src/main.ts"],
    ["an absolute path under the cwd", "/Users/me/proj/src/main.ts", "src/main.ts"],
    ["the cwd's own immediate child", "/Users/me/proj/README.md", "README.md"],
    ["a relative path that doubles back but stays inside", "src/../docs/a.md", "docs/a.md"],
    ["redundant separators", "src//main.ts", "src/main.ts"],
  ])("resolves %s", (_case, token, expected) => {
    expect(pathWithinCwd(token, CWD)).toBe(expected);
  });

  // A plain `startsWith` would accept the sibling directory whose name merely begins with the
  // cwd's — the one containment bug that reads as correct until a real repo has both.
  it("does not mistake a sibling directory for the cwd", () => {
    expect(pathWithinCwd("/Users/me/projector/src/main.ts", CWD)).toBeNull();
    expect(pathWithinCwd("/Users/me/proj2/a.ts", CWD)).toBeNull();
  });

  it.each([
    ["an unrelated absolute path", "/etc/passwd"],
    ["a parent escape", "../outside.ts"],
    ["a deep parent escape", "src/../../outside.ts"],
    ["an absolute path that climbs back out", "/Users/me/proj/../other/a.ts"],
  ])("refuses %s", (_case, token) => {
    expect(pathWithinCwd(token, CWD)).toBeNull();
  });

  it.each([
    ["the cwd itself", "/Users/me/proj"],
    ["the cwd with a trailing slash", "/Users/me/proj/"],
    ["a path that cancels out", "src/.."],
  ])("refuses %s — there is no file to open", (_case, token) => {
    expect(pathWithinCwd(token, CWD)).toBeNull();
  });

  it("refuses everything when the session has not reported a cwd yet", () => {
    expect(pathWithinCwd("src/main.ts", null)).toBeNull();
    expect(pathWithinCwd("src/main.ts", "")).toBeNull();
  });

  // A Windows cwd arrives with backslashes even though the linkified token cannot: the
  // tokenizer splits on `:` and requires a `/`, so `C:\...` never becomes a link. A relative
  // token against a drive-letter cwd is therefore the case that actually happens.
  describe("a Windows cwd", () => {
    const WIN = "C:\\Users\\me\\proj";

    it("resolves a relative token against it", () => {
      expect(pathWithinCwd("src/main.ts", WIN)).toBe("src/main.ts");
    });

    it("accepts an absolute path whose casing differs, as the filesystem would", () => {
      expect(pathWithinCwd("c:/users/ME/proj/src/main.ts", WIN)).toBe("src/main.ts");
    });

    it("still refuses a sibling directory", () => {
      expect(pathWithinCwd("C:/Users/me/projector/a.ts", WIN)).toBeNull();
    });
  });

  // Case folding is Windows-only on purpose: `/A/b` and `/a/b` are two directories on a
  // case-sensitive filesystem, and accepting either would open the wrong one.
  it("does not fold case under a POSIX cwd", () => {
    expect(pathWithinCwd("/users/me/proj/src/main.ts", CWD)).toBeNull();
  });
});

// #2260. The browser cannot expand `~`, so it cannot show such a path is inside the cwd. Treating
// it as cwd-relative sent `~/Downloads/x.md` to the pane, which the server refused once it
// expanded the tilde. A `~` path inside the cell now opens in a tab rather than the pane.
it("does not claim a home-relative path is inside the cwd", () => {
  expect(pathWithinCwd("~/Downloads/report.md", "/Users/me/proj")).toBeNull();
  expect(pathWithinCwd("~", "/Users/me/proj")).toBeNull();
});

describe("rebaseOutsideCwd", () => {
  const CWD = "/Users/me/proj";

  it.each([
    ["an absolute path elsewhere", "/tmp/report.md", { base: "/tmp", rel: "report.md" }],
    ["a file at the filesystem root", "/report.md", { base: "/", rel: "report.md" }],
    ["a home-relative path", "~/Downloads/report.md", { base: "~/Downloads", rel: "report.md" }],
    ["a relative path that climbs out", "../other/notes.ts", { base: "/Users/me/other", rel: "notes.ts" }],
    ["a climb past the filesystem root", "../../../../x.md", { base: "/", rel: "x.md" }],
    ["a sibling whose name starts like the cwd", "/Users/me/projector/a.md", { base: "/Users/me/projector", rel: "a.md" }],
    ["a dot segment in an absolute path", "/tmp/./a/../report.md", { base: "/tmp", rel: "report.md" }],
  ])("rebases %s onto its own directory", (_case, token, expected) => {
    expect(rebaseOutsideCwd(token, CWD)).toEqual(expected);
  });

  it.each([
    ["a relative path inside", "src/main.ts"],
    ["an absolute path inside", "/Users/me/proj/README.md"],
    ["a directory", "/tmp/"],
    ["the home directory itself", "~"],
  ])("leaves %s alone", (_case, token) => {
    expect(rebaseOutsideCwd(token, CWD)).toBeNull();
  });

  it("does nothing without a cwd", () => {
    expect(rebaseOutsideCwd("/tmp/report.md", null)).toBeNull();
  });

  it("climbs out of a Windows cwd with forward slashes", () => {
    expect(rebaseOutsideCwd("../x.md", "C:\\Users\\me\\proj")).toEqual({ base: "C:/Users/me", rel: "x.md" });
  });
});
