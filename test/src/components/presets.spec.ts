import { describe, it, expect } from "vitest";
import { presetLabel } from "../../src/components/presets.js";

describe("presetLabel", () => {
  it("uses the trailing path segment (basename)", () => {
    expect(presetLabel("/home/me/my-project")).toBe("my-project");
    expect(presetLabel("/home/me/my-project/")).toBe("my-project"); // ignores a trailing slash
  });

  it("labels a managed worktree as 'repo (task)'", () => {
    expect(presetLabel("/home/me/worktrees/myrepo-1a2b3c4d/fix-bug")).toBe("myrepo (fix-bug)");
  });

  it("handles a Windows-style path", () => {
    expect(presetLabel("C:\\work\\proj")).toBe("proj");
  });
});
