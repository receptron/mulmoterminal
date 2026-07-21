import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { projectSessionsDir } from "../../../server/session/session-reads.js";

// Claude owns this encoding — we only mirror it to find the directory it already wrote.
// Pinned because a mismatch is silent: the wrong path just reads as "no sessions yet".
describe("projectSessionsDir", () => {
  const projects = path.join(os.homedir(), ".claude", "projects");

  it("encodes an absolute posix path with / and . folded to -", () => {
    expect(projectSessionsDir("/Users/me/ss/my.app")).toBe(path.join(projects, "-Users-me-ss-my-app"));
  });

  it("resolves a relative path first, so the same dir maps to one directory", () => {
    expect(projectSessionsDir("/ws/sub/../app")).toBe(projectSessionsDir("/ws/app"));
  });

  it("keeps different workspaces apart", () => {
    expect(projectSessionsDir("/ws/app")).not.toBe(projectSessionsDir("/ws/app2"));
  });

  it("lands under ~/.claude/projects", () => {
    expect(projectSessionsDir("/ws/app").startsWith(projects)).toBe(true);
  });

  // Two paths that differ only in "/" vs "." collapse to the same name. That is Claude's
  // scheme, not ours; the test records the collision so a future reader knows it is known
  // rather than assuming the encoding is injective.
  it("collides where Claude's own encoding collides", () => {
    expect(projectSessionsDir("/ws/a.b")).toBe(projectSessionsDir("/ws/a/b"));
  });
});
