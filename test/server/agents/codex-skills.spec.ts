import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncCodexSkills, codexifySkillSeed } from "../../../../server/../../server/agents/codex-skills.js";

describe("codexifySkillSeed", () => {
  it("rewrites a /<slug> <msg> chat seed to name the skill in natural language", () => {
    expect(codexifySkillSeed("/art-exhibitions はろー")).toBe('Use the "art-exhibitions" skill.\n\nはろー');
  });
  it("handles a slug with no message", () => {
    expect(codexifySkillSeed("/books")).toBe('Use the "books" skill.');
  });
  it("preserves the record id + message in the rest", () => {
    expect(codexifySkillSeed("/movies id=42 mark as seen")).toBe('Use the "movies" skill.\n\nid=42 mark as seen');
  });
  it("leaves a non-slash prompt unchanged (a collection action's natural-language seed)", () => {
    expect(codexifySkillSeed("Repair this record's fields")).toBe("Repair this record's fields");
  });
});

describe("syncCodexSkills", () => {
  let src: string;
  let dst: string;
  const skillDir = (root: string, name: string): string => path.join(root, name);
  function writeSkill(root: string, name: string, body: string): void {
    mkdirSync(skillDir(root, name), { recursive: true });
    writeFileSync(path.join(skillDir(root, name), "SKILL.md"), body);
  }
  beforeEach(() => {
    src = mkdtempSync(path.join(tmpdir(), "mt-skills-src-"));
    dst = mkdtempSync(path.join(tmpdir(), "mt-skills-dst-"));
  });
  afterEach(() => {
    rmSync(src, { recursive: true, force: true });
    rmSync(dst, { recursive: true, force: true });
  });

  it("mirrors workspace skills into the codex dir with an ownership marker", () => {
    writeSkill(src, "art-exhibitions", "# skill");
    const res = syncCodexSkills(src, dst);
    expect(res.mirrored).toEqual(["art-exhibitions"]);
    expect(existsSync(path.join(dst, "art-exhibitions", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(dst, "art-exhibitions", ".mt-mirror"))).toBe(true);
  });

  it("does NOT clobber a codex-owned skill of the same name (no marker)", () => {
    writeSkill(src, "wrangler", "# ours");
    writeSkill(dst, "wrangler", "# codex original"); // pre-existing, unmarked = codex's own
    const res = syncCodexSkills(src, dst);
    expect(res.skipped).toEqual(["wrangler"]);
    expect(readFileSync(path.join(dst, "wrangler", "SKILL.md"), "utf8")).toBe("# codex original");
  });

  it("re-copies a previously-mirrored skill (drops files removed from source)", () => {
    writeSkill(src, "books", "# v2");
    // simulate a prior mirror: marked dir with a stale extra file
    mkdirSync(path.join(dst, "books"), { recursive: true });
    writeFileSync(path.join(dst, "books", ".mt-mirror"), "x");
    writeFileSync(path.join(dst, "books", "stale.txt"), "old");
    const res = syncCodexSkills(src, dst);
    expect(res.mirrored).toEqual(["books"]);
    expect(readFileSync(path.join(dst, "books", "SKILL.md"), "utf8")).toBe("# v2");
    expect(existsSync(path.join(dst, "books", "stale.txt"))).toBe(false);
  });

  it("no-ops when the source doesn't exist", () => {
    expect(syncCodexSkills(path.join(src, "nope"), dst)).toEqual({ mirrored: [], skipped: [] });
  });
});
