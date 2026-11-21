// @vitest-environment node
// Editing a skill's SKILL.md (#3332): only the user's and a project's own, and only over the text read.
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isEditableSkill, writeSkillDoc } from "../../../../server/backends/skills/skillEdit";
import { memoryVersion } from "../../../../server/backends/library/memory-write";
import { BUNDLED_SKILL_NAMES } from "../../../../common/bundledSkills";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "mt-skill-edit-"));
  dirs.push(root);
  const userDir = path.join(root, ".claude", "skills");
  mkdirSync(path.join(userDir, "review"), { recursive: true });
  writeFileSync(path.join(userDir, "review", "SKILL.md"), "---\nname: review\n---\nRead it all.");
  const read = () => readFileSync(path.join(userDir, "review", "SKILL.md"), "utf8");
  return { userDir, read, request: { userDir, cwds: [], source: { scope: "user" as const }, slug: "review" } };
}

describe("isEditableSkill", () => {
  it("is the user's and a project's own skills, not a plugin's nor one MulmoTerminal ships", () => {
    const bundled = BUNDLED_SKILL_NAMES[0] ?? "";
    expect(isEditableSkill({ scope: "user" }, "review")).toBe(true);
    expect(isEditableSkill({ scope: "project", dir: "/w/app" }, bundled)).toBe(true);
    expect(isEditableSkill({ scope: "user" }, bundled)).toBe(false);
    expect(isEditableSkill({ scope: "plugin", plugin: "p@m" }, "review")).toBe(false);
  });
});

describe("writeSkillDoc", () => {
  it("writes over the version it was opened on, and not over a change made since", async () => {
    const { read, request } = setup();
    const opened = read();
    expect(await writeSkillDoc(request, "---\nname: review\n---\nRead it twice.", memoryVersion(opened))).toEqual({
      kind: "written",
      version: memoryVersion("---\nname: review\n---\nRead it twice."),
    });
    expect(read()).toBe("---\nname: review\n---\nRead it twice.");
    expect(await writeSkillDoc(request, "lost", memoryVersion(opened))).toEqual({ kind: "conflict", version: memoryVersion(read()) });
    expect(read()).toBe("---\nname: review\n---\nRead it twice.");
  });
  it("refuses a skill that is not one to edit, or a name that is not a skill's", async () => {
    const { read, request } = setup();
    const version = memoryVersion(read());
    expect(await writeSkillDoc({ ...request, source: { scope: "plugin", plugin: "p@m" } }, "x", version)).toEqual({ kind: "refused" });
    expect(await writeSkillDoc({ ...request, slug: "../escape" }, "x", version)).toEqual({ kind: "refused" });
    expect(await writeSkillDoc({ ...request, source: { scope: "project", dir: "/never/ran/here" } }, "x", version)).toEqual({ kind: "refused" });
    expect(read()).toBe("---\nname: review\n---\nRead it all.");
  });
  it("refuses a bundled skill in the user's folder, which the next start would copy over", async () => {
    const { userDir, request } = setup();
    const bundled = BUNDLED_SKILL_NAMES[0] ?? "";
    mkdirSync(path.join(userDir, bundled), { recursive: true });
    writeFileSync(path.join(userDir, bundled, "SKILL.md"), "shipped");
    expect(await writeSkillDoc({ ...request, slug: bundled }, "mine", memoryVersion("shipped"))).toEqual({ kind: "refused" });
    expect(readFileSync(path.join(userDir, bundled, "SKILL.md"), "utf8")).toBe("shipped");
  });
});
