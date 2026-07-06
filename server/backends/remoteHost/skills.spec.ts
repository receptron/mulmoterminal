// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverSkillNames } from "./skills.js";

// Write `<root>/.claude/skills/<name>/SKILL.md` with the given contents.
const writeSkill = (root: string, name: string, contents: string): void => {
  const dir = path.join(root, ".claude", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), contents);
};

const SKILL_MD = "---\ndescription: does a thing\n---\n\nbody";

describe("discoverSkillNames", () => {
  let userHome: string; // stands in for ~ (its .claude/skills is the user root)
  let ws: string;

  beforeEach(() => {
    userHome = mkdtempSync(path.join(tmpdir(), "mt-skills-user-"));
    ws = mkdtempSync(path.join(tmpdir(), "mt-skills-ws-"));
  });
  afterEach(() => {
    rmSync(userHome, { recursive: true, force: true });
    rmSync(ws, { recursive: true, force: true });
  });

  const userDir = () => path.join(userHome, ".claude", "skills");

  it("returns skill ids from both user and project scopes, sorted", async () => {
    writeSkill(userHome, "zed", SKILL_MD);
    writeSkill(userHome, "alpha", SKILL_MD);
    writeSkill(ws, "mid", SKILL_MD);
    expect(await discoverSkillNames({ workspaceRoot: ws, userDir: userDir() })).toEqual(["alpha", "mid", "zed"]);
  });

  it("dedupes a name present in both scopes (project shadows user)", async () => {
    writeSkill(userHome, "shared", SKILL_MD);
    writeSkill(ws, "shared", SKILL_MD);
    writeSkill(ws, "only", SKILL_MD);
    expect(await discoverSkillNames({ workspaceRoot: ws, userDir: userDir() })).toEqual(["only", "shared"]);
  });

  it("skips dirs whose SKILL.md lacks frontmatter or a description", async () => {
    writeSkill(ws, "no-frontmatter", "# just a heading\n\nbody");
    writeSkill(ws, "no-description", "---\nroleId: general\n---\n\nbody");
    writeSkill(ws, "unterminated", "---\ndescription: x\n\nbody");
    writeSkill(ws, "good", SKILL_MD);
    expect(await discoverSkillNames({ workspaceRoot: ws, userDir: userDir() })).toEqual(["good"]);
  });

  it("skips non-directory and SKILL.md-less entries, and hidden entries", async () => {
    const skillsRoot = path.join(ws, ".claude", "skills");
    mkdirSync(skillsRoot, { recursive: true });
    writeFileSync(path.join(skillsRoot, "loose-file.md"), "not a dir");
    mkdirSync(path.join(skillsRoot, "empty-dir"));
    mkdirSync(path.join(skillsRoot, ".hidden"));
    writeFileSync(path.join(skillsRoot, ".hidden", "SKILL.md"), SKILL_MD);
    writeSkill(ws, "real", SKILL_MD);
    expect(await discoverSkillNames({ workspaceRoot: ws, userDir: userDir() })).toEqual(["real"]);
  });

  it("follows a symlinked skill directory", async () => {
    const target = mkdtempSync(path.join(tmpdir(), "mt-skills-ext-"));
    writeFileSync(path.join(target, "SKILL.md"), SKILL_MD);
    const skillsRoot = path.join(ws, ".claude", "skills");
    mkdirSync(skillsRoot, { recursive: true });
    symlinkSync(target, path.join(skillsRoot, "linked"));
    try {
      expect(await discoverSkillNames({ workspaceRoot: ws, userDir: userDir() })).toEqual(["linked"]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it("returns an empty list when neither root exists", async () => {
    expect(await discoverSkillNames({ workspaceRoot: ws, userDir: userDir() })).toEqual([]);
  });
});
