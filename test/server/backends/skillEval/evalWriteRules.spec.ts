// @vitest-environment node
// The drafting cell's save folder is allowed ahead of time (#3507): a rule Claude Code cannot match, or
// that breaks `--allowedTools`' comma list, must come out as no rule rather than a wrong one.
import { describe, expect, it } from "vitest";
import { claudeRulePath, evalDirWriteRules } from "../../../../server/backends/skillEval/evalWriteRules.js";

describe("claudeRulePath", () => {
  it("keeps a POSIX path, normalised", () => {
    expect(claudeRulePath("/Users/me/.mulmoterminal/skill-evals/weekly", "darwin")).toBe("/Users/me/.mulmoterminal/skill-evals/weekly");
    expect(claudeRulePath("/home/me/a/../skill-evals//weekly/", "linux")).toBe("/home/me/skill-evals/weekly/");
  });

  it("writes a Windows drive as /<letter>/ with forward slashes", () => {
    expect(claudeRulePath("C:\\Users\\me\\.mulmoterminal\\skill-evals\\weekly", "win32")).toBe("/c/Users/me/.mulmoterminal/skill-evals/weekly");
    expect(claudeRulePath("d:/work/evals", "win32")).toBe("/d/work/evals");
  });
});

describe("evalDirWriteRules", () => {
  it("allows Write and Edit anywhere under the folder, as absolute rules", () => {
    expect(evalDirWriteRules("/Users/me/.mulmoterminal/skill-evals/weekly@1a2b3c4d", "darwin")).toEqual([
      "Write(//Users/me/.mulmoterminal/skill-evals/weekly@1a2b3c4d/**)",
      "Edit(//Users/me/.mulmoterminal/skill-evals/weekly@1a2b3c4d/**)",
    ]);
    expect(evalDirWriteRules("/home/me/skill-evals/weekly/", "linux")).toEqual([
      "Write(//home/me/skill-evals/weekly/**)",
      "Edit(//home/me/skill-evals/weekly/**)",
    ]);
    expect(evalDirWriteRules("C:\\Users\\me\\skill-evals\\weekly", "win32")).toEqual([
      "Write(//c/Users/me/skill-evals/weekly/**)",
      "Edit(//c/Users/me/skill-evals/weekly/**)",
    ]);
  });

  it("names no rule for a path the flag or the rule syntax could not carry", () => {
    expect(evalDirWriteRules("/Users/me/skill-evals/a,b", "darwin")).toEqual([]);
    expect(evalDirWriteRules("/Users/me/skill-evals/a(b)", "darwin")).toEqual([]);
    expect(evalDirWriteRules("relative/skill-evals/weekly", "darwin")).toEqual([]);
    expect(evalDirWriteRules("", "darwin")).toEqual([]);
    expect(evalDirWriteRules("/", "darwin")).toEqual([]);
    expect(evalDirWriteRules("/a/..", "linux")).toEqual([]);
    expect(evalDirWriteRules("C:\\", "win32")).toEqual([]);
    expect(evalDirWriteRules("d:/", "win32")).toEqual([]);
    expect(evalDirWriteRules("skill-evals\\weekly", "win32")).toEqual([]);
  });
});
