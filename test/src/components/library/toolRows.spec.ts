// How the tools kind names an instruction file (#3332).
import { describe, it, expect } from "vitest";
import { instructionLabel } from "../../../../src/components/library/toolRows";

describe("instructionLabel", () => {
  it.each([
    ["/w/app/CLAUDE.md", "/w/app", "CLAUDE.md"],
    ["/w/app/.claude/rules/a.md", "/w/app/", ".claude/rules/a.md"],
    ["C:\\w\\app\\CLAUDE.md", "C:\\w\\app", "CLAUDE.md"],
    ["/w/CLAUDE.md", "/w/app", "/w/CLAUDE.md"],
    ["/w/application/CLAUDE.md", "/w/app", "/w/application/CLAUDE.md"],
    ["/h/.claude/CLAUDE.md", "", "/h/.claude/CLAUDE.md"],
  ])("%s under %s is %s", (file, cwd, label) => {
    expect(instructionLabel({ path: file }, cwd)).toBe(label);
  });
});
