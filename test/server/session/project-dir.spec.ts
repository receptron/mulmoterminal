import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { encodeProjectDirName, projectSessionsDir } from "../../../server/session/project-dir.js";

// Claude owns this encoding — we only mirror it to find the directory it already wrote.
// Pinned because a mismatch is silent: the wrong path just reads as "no sessions yet".
// encodeProjectDirName takes an already-absolute path, so these cases are the same on
// every host OS (a POSIX case does not stop being valid when the tests run on Windows).
describe("encodeProjectDirName", () => {
  it("folds the separators and dots of a posix path", () => {
    expect(encodeProjectDirName("/Users/me/ss/my.app")).toBe("-Users-me-ss-my-app");
  });

  it("folds a windows drive letter and backslashes", () => {
    expect(encodeProjectDirName("C:\\Users\\me\\my.app")).toBe("C--Users-me-my-app");
  });

  it("folds every non-alphanumeric character, not just / and .", () => {
    expect(encodeProjectDirName("/ws/my_app v2 (old)@home~")).toBe("-ws-my-app-v2--old--home-");
  });

  it("keeps a digits-and-letters path untouched", () => {
    expect(encodeProjectDirName("ws2024app")).toBe("ws2024app");
  });

  it("folds non-ascii characters too", () => {
    expect(encodeProjectDirName("/ws/日本語")).toBe("-ws----");
  });

  it("encodes an empty path as an empty name", () => {
    expect(encodeProjectDirName("")).toBe("");
  });

  // Two paths differing only in which non-alphanumeric character they use collapse to
  // the same name. That is Claude's scheme, not ours; recorded so a future reader knows
  // the collision is known rather than assuming the encoding is injective.
  it("collides where Claude's own encoding collides", () => {
    expect(encodeProjectDirName("/ws/a.b")).toBe(encodeProjectDirName("/ws/a/b"));
    expect(encodeProjectDirName("/ws/a_b")).toBe(encodeProjectDirName("/ws/a-b"));
  });

  it("keeps different workspaces apart", () => {
    expect(encodeProjectDirName("/ws/app")).not.toBe(encodeProjectDirName("/ws/app2"));
  });

  describe("length cap", () => {
    // 200 is the boundary: at or under it the name is the plain fold; past it claude
    // truncates to 200 and appends a hash of the FULL path, so long workspaces stay
    // distinguishable. Getting either side wrong points at a directory that isn't there.
    const atCap = `/${"a".repeat(199)}`;
    const overCap = `/${"a".repeat(200)}`;

    it("leaves a name of exactly 200 characters unhashed", () => {
      const encoded = encodeProjectDirName(atCap);
      expect(encoded).toHaveLength(200);
      expect(encoded).toBe(`-${"a".repeat(199)}`);
    });

    it("truncates to 200 and appends a base36 hash once past the cap", () => {
      const encoded = encodeProjectDirName(overCap);
      expect(encoded.slice(0, 200)).toBe(`-${"a".repeat(199)}`);
      expect(encoded.slice(200)).toMatch(/^-[0-9a-z]+$/);
    });

    it("hashes the full path, so two paths sharing a 200-char prefix stay apart", () => {
      expect(encodeProjectDirName(`${overCap}/one`)).not.toBe(encodeProjectDirName(`${overCap}/two`));
    });

    it("reproduces claude's 32-bit rolling hash exactly", () => {
      // The upstream hash: h = (h << 5) - h + charCode, wrapped to int32, then
      // Math.abs(...).toString(36). Recomputed here from the spec rather than from our
      // own implementation, so a rewrite of the hash cannot quietly redefine "correct".
      let hash = 0;
      for (let i = 0; i < overCap.length; i++) hash = ((hash << 5) - hash + overCap.charCodeAt(i)) | 0;
      expect(encodeProjectDirName(overCap)).toBe(`-${"a".repeat(199)}-${Math.abs(hash).toString(36)}`);
    });
  });
});

// projectSessionsDir resolves against the host's cwd rules, so it can only be asserted
// on OS-independent properties here; the encoding itself is covered above.
describe("projectSessionsDir", () => {
  const projects = path.join(os.homedir(), ".claude", "projects");

  it("lands under ~/.claude/projects", () => {
    expect(projectSessionsDir("/ws/app").startsWith(projects)).toBe(true);
  });

  it("applies the encoding to the resolved absolute path", () => {
    expect(projectSessionsDir("/ws/app")).toBe(path.join(projects, encodeProjectDirName(path.resolve("/ws/app"))));
  });

  it("resolves a relative path first, so the same dir maps to one directory", () => {
    expect(projectSessionsDir("/ws/sub/../app")).toBe(projectSessionsDir("/ws/app"));
  });

  it("keeps different workspaces apart", () => {
    expect(projectSessionsDir("/ws/app")).not.toBe(projectSessionsDir("/ws/app2"));
  });

  it("never nests: the encoded name is a single path segment", () => {
    // The bug this replaced: an unfolded separator (a Windows "\" or a drive colon)
    // survived into path.join and silently produced a nested directory.
    const encoded = projectSessionsDir("/ws/a/b.c").slice(projects.length + 1);
    expect(encoded).not.toContain(path.sep);
    expect(encoded).toBe(path.basename(projectSessionsDir("/ws/a/b.c")));
  });
});
