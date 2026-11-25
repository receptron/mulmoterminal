// @vitest-environment node
// The drafting cell's save folder is allowed ahead of time (#3507). The rule must never cover more than
// that one folder: anything that could — another place, a glob, a link — comes out as no rule.
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeRulePath, evalDirWriteRules, isDirectChild } from "../../../../server/backends/skillEval/evalWriteRules.js";
import { authorWriteRules } from "../../../../server/backends/skillEval/evalWriteRulesOnDisk.js";

const ROOT = "/Users/me/.mulmoterminal/skill-evals";
const WIN_ROOT = "C:\\Users\\me\\.mulmoterminal\\skill-evals";

describe("claudeRulePath", () => {
  it("keeps a POSIX path, normalised", () => {
    expect(claudeRulePath(`${ROOT}/weekly`, "darwin")).toBe(`${ROOT}/weekly`);
    expect(claudeRulePath("/home/me/a/../skill-evals//weekly/", "linux")).toBe("/home/me/skill-evals/weekly/");
  });

  it("writes a Windows drive as /<letter>/ with forward slashes", () => {
    expect(claudeRulePath(`${WIN_ROOT}\\weekly`, "win32")).toBe("/c/Users/me/.mulmoterminal/skill-evals/weekly");
    expect(claudeRulePath("d:/work/evals", "win32")).toBe("/d/work/evals");
  });
});

describe("isDirectChild", () => {
  it("accepts one folder directly under the root", () => {
    expect(isDirectChild(ROOT, `${ROOT}/weekly@1a2b3c4d`, "darwin")).toBe(true);
    expect(isDirectChild(`${ROOT}/`, `${ROOT}/weekly/`, "linux")).toBe(true);
    expect(isDirectChild(WIN_ROOT, `${WIN_ROOT}\\plugin__weekly`, "win32")).toBe(true);
  });

  it("refuses the root itself, anything above or beside it, a deeper folder, and a relative path", () => {
    expect(isDirectChild(ROOT, ROOT, "darwin")).toBe(false);
    expect(isDirectChild(ROOT, "/Users/me/.mulmoterminal", "darwin")).toBe(false);
    expect(isDirectChild(ROOT, `${ROOT}/../../.ssh`, "darwin")).toBe(false);
    expect(isDirectChild(ROOT, `${ROOT}/../skill-evals-other`, "darwin")).toBe(false);
    expect(isDirectChild(ROOT, `${ROOT}/a/b`, "darwin")).toBe(false);
    expect(isDirectChild(ROOT, `${ROOT}/plugin__x/../../..`, "darwin")).toBe(false);
    expect(isDirectChild(ROOT, "skill-evals/weekly", "darwin")).toBe(false);
    expect(isDirectChild("relative", "relative/weekly", "darwin")).toBe(false);
    expect(isDirectChild(WIN_ROOT, "D:\\elsewhere\\weekly", "win32")).toBe(false);
    expect(isDirectChild(WIN_ROOT, `${WIN_ROOT}\\a\\b`, "win32")).toBe(false);
  });
});

describe("evalDirWriteRules", () => {
  it("allows Write and Edit anywhere under the folder, as absolute rules", () => {
    expect(evalDirWriteRules(`${ROOT}/weekly@1a2b3c4d`, ROOT, "darwin")).toEqual([`Write(/${ROOT}/weekly@1a2b3c4d/**)`, `Edit(/${ROOT}/weekly@1a2b3c4d/**)`]);
    expect(evalDirWriteRules("/home/me/skill-evals/weekly/", "/home/me/skill-evals", "linux")).toEqual([
      "Write(//home/me/skill-evals/weekly/**)",
      "Edit(//home/me/skill-evals/weekly/**)",
    ]);
    expect(evalDirWriteRules(`${WIN_ROOT}\\weekly`, WIN_ROOT, "win32")).toEqual([
      "Write(//c/Users/me/.mulmoterminal/skill-evals/weekly/**)",
      "Edit(//c/Users/me/.mulmoterminal/skill-evals/weekly/**)",
    ]);
  });

  it("names no rule for a folder outside the root, or a path a rule could read as more", () => {
    expect(evalDirWriteRules(`${ROOT}/../../..`, ROOT, "darwin")).toEqual([]);
    expect(evalDirWriteRules("/", ROOT, "darwin")).toEqual([]);
    expect(evalDirWriteRules(ROOT, ROOT, "darwin")).toEqual([]);
    expect(evalDirWriteRules("C:\\", WIN_ROOT, "win32")).toEqual([]);
    for (const name of ["a*", "a?", "a[ab]", "a{b,c}", "a,b", "a(b)", "a]"]) {
      expect(evalDirWriteRules(`${ROOT}/${name}`, ROOT, "darwin")).toEqual([]);
    }
    expect(evalDirWriteRules("/Users/m*/skill-evals/weekly", "/Users/m*/skill-evals", "darwin")).toEqual([]);
    expect(evalDirWriteRules("", ROOT, "darwin")).toEqual([]);
  });
});

describe("authorWriteRules", () => {
  const made: string[] = [];
  const tmp = (): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mt-eval-rules-"));
    made.push(dir);
    return dir;
  };
  afterEach(() => made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("names the folder as written and as the disk resolves it, and makes a missing root", async () => {
    const base = tmp();
    const root = path.join(base, "skill-evals");
    const evalDir = path.join(root, "weekly");
    const real = path.join(realpathSync(base), "skill-evals", "weekly");
    const rules = await authorWriteRules(evalDir, root);
    expect(rules).toEqual([...new Set([...evalDirWriteRules(evalDir, root), ...evalDirWriteRules(real, path.dirname(real))])]);
    expect(rules).toContain(`Write(/${claudeRulePath(real)}/**)`);
    expect(realpathSync(root)).toBe(path.dirname(real));
  });

  it("names nothing for a folder that is a link to somewhere else, or one outside the root", async () => {
    const base = tmp();
    const root = path.join(base, "skill-evals");
    const elsewhere = path.join(base, "elsewhere");
    mkdirSync(root, { recursive: true });
    mkdirSync(elsewhere);
    // A junction needs no privilege on Windows, where a directory symlink may.
    symlinkSync(elsewhere, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(await authorWriteRules(path.join(root, "linked"), root)).toEqual([]);
    expect(await authorWriteRules(path.join(root, "..", "elsewhere"), root)).toEqual([]);
    expect(await authorWriteRules(path.join(root, "a", "b"), root)).toEqual([]);
  });
});
