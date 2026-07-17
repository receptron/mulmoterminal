// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { discoverSkillNames, discoverSkills, applySkillFilter } from "../../../../server/backends/remoteHost/skills.js";

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

describe("discoverSkills", () => {
  let userHome: string;
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

  it("lists working-dir (project) skills first, then user skills (alpha within each)", async () => {
    writeSkill(userHome, "alpha", "---\ndescription: a user skill\n---\n\nbody");
    writeSkill(userHome, "beta", "---\ndescription: another user skill\n---\n\nbody");
    writeSkill(ws, "zed", "---\ndescription: a project skill\n---\n\nbody");
    writeSkill(ws, "mid", "---\ndescription: another project skill\n---\n\nbody");
    // project (mid, zed) lead — alpha-ordered within — then user (alpha, beta), even
    // though a global alpha sort would interleave them.
    expect((await discoverSkills({ workspaceRoot: ws, userDir: userDir() })).map((s) => s.slug)).toEqual(["mid", "zed", "alpha", "beta"]);
  });

  it("strips surrounding quotes from a quoted description", async () => {
    writeSkill(ws, "quoted", '---\ndescription: "quoted, with a comma"\n---\n\nbody');
    expect(await discoverSkills({ workspaceRoot: ws, userDir: userDir() })).toEqual([{ slug: "quoted", description: "quoted, with a comma" }]);
  });

  it("lets a project skill's description shadow the user one of the same slug", async () => {
    writeSkill(userHome, "shared", "---\ndescription: user version\n---\n\nbody");
    writeSkill(ws, "shared", "---\ndescription: project version\n---\n\nbody");
    expect(await discoverSkills({ workspaceRoot: ws, userDir: userDir() })).toEqual([{ slug: "shared", description: "project version" }]);
  });

  it("skips dirs whose SKILL.md lacks frontmatter or a description", async () => {
    writeSkill(ws, "no-frontmatter", "# just a heading\n\nbody");
    writeSkill(ws, "unterminated", "---\ndescription: x\n\nbody");
    writeSkill(ws, "good", SKILL_MD);
    expect(await discoverSkills({ workspaceRoot: ws, userDir: userDir() })).toEqual([{ slug: "good", description: "does a thing" }]);
  });

  // A malformed slug is typed verbatim into the session as /<slug>, so a name with
  // whitespace/quotes (e.g. from an untrusted repo's .claude/skills) must never be
  // discovered — even with valid frontmatter.
  it("rejects dir names that aren't safe slugs (whitespace/quotes/leading dash)", async () => {
    writeSkill(ws, "bad name", SKILL_MD); // space
    writeSkill(ws, 'q"uote', SKILL_MD); // quote
    writeSkill(ws, "-lead", SKILL_MD); // non-alnum start
    writeSkill(ws, "safe-slug_1", SKILL_MD); // the only valid one
    expect((await discoverSkills({ workspaceRoot: ws, userDir: userDir() })).map((s) => s.slug)).toEqual(["safe-slug_1"]);
  });
});

describe("applySkillFilter", () => {
  const skills = [
    { slug: "commit", description: "c" },
    { slug: "review", description: "r" },
    { slug: "deploy", description: "d" },
  ];

  it("returns the skills unchanged when the filter is null (no config → show all)", () => {
    expect(applySkillFilter(skills, null)).toBe(skills);
  });

  it("keeps only the listed slugs, in the filter's order", () => {
    expect(applySkillFilter(skills, ["review", "commit"]).map((s) => s.slug)).toEqual(["review", "commit"]);
  });

  it("drops a filter slug that isn't discovered", () => {
    expect(applySkillFilter(skills, ["review", "ghost", "commit"]).map((s) => s.slug)).toEqual(["review", "commit"]);
  });

  it("yields an empty list when the filter matches nothing", () => {
    expect(applySkillFilter(skills, ["nope"])).toEqual([]);
  });
});
