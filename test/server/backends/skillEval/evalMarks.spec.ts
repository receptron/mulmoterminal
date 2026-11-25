// @vitest-environment node
// The marks the Skills viewer's list shows (#3467), read out of real evaluation folders: a user's and a project's
// skill, the verdict of the measurement of the text as it is now, "not measured" once the text moved on, and the
// folders that cannot be matched to a skill here passed over rather than guessed at.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { folderProject, readEvalMarks, skillSourceOf } from "../../../../server/backends/skillEval/evalMarks";
import { skillEvalFolder, textHash, writeRun } from "../../../../server/backends/skillEval/evalStore";
import { skillEvalMark, needsAttention, wantsAttention, markKey } from "../../../../common/skillEvalMark";
import type { SkillEvalAttempt, SkillEvalCase, SkillEvalRun } from "../../../../common/skillEval";
import type { SkillEvalMark } from "../../../../common/skillEvalMark";
import { mountSkillEvalRoutes } from "../../../../server/routes/skill-eval-routes";
import { routeCall } from "../../../helpers/routeCall";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const scratch = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-skill-marks-"));
  dirs.push(dir);
  return dir;
};

const SKILL_TEXT = "---\nname: weekly\n---\nWrite notes.\n";
const CASES: SkillEvalCase[] = [{ id: "a", title: "A", kind: "use", prompt: "p", check: { type: "command", command: "true" } }];
const setText = (skill: string): string => JSON.stringify({ version: 1, skill, repeats: 1, cases: CASES });

const attempt = (arm: "with" | "without", pass: boolean): SkillEvalAttempt => ({
  ...{ caseId: "a", arm, round: 0, pass, skillInvoked: arm === "with", costUsd: 0, gradingCostUsd: 0, durationMs: 0 },
  ...{ finalText: "", checkOutput: "", denied: [], error: null, model: "haiku", reusedFrom: "" },
});

function measured(skill: string, set: string, skillText: string, withPass: boolean, id = "1795000000000-aaaaaaaa"): SkillEvalRun {
  return {
    ...{ id, skill, status: "done", startedAt: 1, finishedAt: 2, model: "haiku", repeats: 1, skillText, skillHash: textHash(skillText) },
    ...{ setHash: textHash(set), cases: CASES, plannedAttempts: 2, attempts: [attempt("with", withPass), attempt("without", false)] },
    ...{ candidateId: null, note: "", improveCostUsd: 0, baseSkillHash: "", baseRunId: null, ladder: [], interruptedBy: "" },
  };
}

/** A skill on disk with a set of tasks, measured as given. */
async function evaluated(root: string, skillsDir: string, skill: string, projectDir: string | null, runs: (set: string) => SkillEvalRun[]): Promise<void> {
  mkdirSync(path.join(skillsDir, skill), { recursive: true });
  writeFileSync(path.join(skillsDir, skill, "SKILL.md"), SKILL_TEXT);
  const evalDir = skillEvalFolder(root, skill, projectDir);
  mkdirSync(evalDir, { recursive: true });
  const set = setText(skill);
  writeFileSync(path.join(evalDir, "cases.json"), set);
  for (const run of runs(set)) await writeRun(evalDir, run);
}

describe("reading the marks", () => {
  it("gives a user's and a project's skill the verdict of the measurement of their text as it is now", async () => {
    const root = scratch();
    const userDir = scratch();
    const project = scratch();
    await evaluated(root, userDir, "weekly", null, (set) => [measured("weekly", set, SKILL_TEXT, true)]);
    await evaluated(root, path.join(project, ".claude", "skills"), "tidy", project, (set) => [measured("tidy", set, SKILL_TEXT, false)]);
    const marks = await readEvalMarks(root, { cwds: [project], userDir });
    expect(marks.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "tidy", projectDir: project, mark: "no-evidence" },
      { id: "weekly", projectDir: null, mark: "helps" },
    ]);
  });

  it("says not measured once the SKILL.md moved on from every measurement, or when there is none", async () => {
    const root = scratch();
    const userDir = scratch();
    await evaluated(root, userDir, "weekly", null, (set) => [measured("weekly", set, "an older text", true)]);
    await evaluated(root, userDir, "fresh", null, () => []);
    const marks = await readEvalMarks(root, { cwds: [], userDir });
    expect(marks.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "fresh", projectDir: null, mark: "unmeasured" },
      { id: "weekly", projectDir: null, mark: "unmeasured" },
    ]);
  });

  it("passes over a folder it cannot match: no known project, a set for another skill, no set, a skill gone", async () => {
    const root = scratch();
    const userDir = scratch();
    const project = scratch();
    // A project nobody has opened a terminal in since.
    await evaluated(root, path.join(project, ".claude", "skills"), "tidy", project, () => []);
    // A set saying it is for another skill than its folder.
    await evaluated(root, userDir, "weekly", null, () => []);
    writeFileSync(path.join(root, "weekly", "cases.json"), setText("other"));
    // ...even when that other skill is installed: the mark would be the wrong skill's.
    mkdirSync(path.join(userDir, "other"), { recursive: true });
    writeFileSync(path.join(userDir, "other", "SKILL.md"), SKILL_TEXT);
    // No set, a set that is not JSON, and a skill that was removed.
    mkdirSync(path.join(root, "bare"), { recursive: true });
    mkdirSync(path.join(root, "broken"), { recursive: true });
    writeFileSync(path.join(root, "broken", "cases.json"), "{not json");
    await evaluated(root, userDir, "gone", null, () => []);
    rmSync(path.join(userDir, "gone"), { recursive: true });
    writeFileSync(path.join(root, "a-file"), "");
    expect(await readEvalMarks(root, { cwds: [], userDir })).toEqual([]);
  });

  it("is empty when there is no evaluation folder at all", async () => {
    expect(await readEvalMarks(path.join(scratch(), "missing"), { cwds: [] })).toEqual([]);
  });
});

describe("GET /api/skill-evals/marks", () => {
  it("answers the marks for the directories terminals have run in", async () => {
    const root = scratch();
    const project = scratch();
    await evaluated(root, path.join(project, ".claude", "skills"), "tidy", project, (set) => [measured("tidy", set, SKILL_TEXT, true)]);
    const server = express();
    mountSkillEvalRoutes(server, { root, cwds: () => Promise.resolve([project]) });
    const answer = await routeCall(server)("/api/skill-evals/marks");
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ marks: [{ id: "tidy", projectDir: project, mark: "helps" }] });
  });
});

describe("matching a folder to its skill", () => {
  it("finds a project's directory by the hash in the folder's name, and no project in a name without one", () => {
    expect(folderProject("weekly", ["/a"])).toBeNull();
    expect(folderProject(`weekly@${textHash("/b").slice(0, 8)}`, ["/a", "/b"])).toBe("/b");
    expect(folderProject(`weekly@${textHash("/c").slice(0, 8)}`, ["/a", "/b"])).toBeUndefined();
    expect(folderProject("weekly@", [])).toBeUndefined();
  });

  it("reads a plugin's skill from its `plugin:slug` name, and the rest as the user's or the project's", () => {
    expect(skillSourceOf("tools:weekly", null)).toEqual({ source: { scope: "plugin", plugin: "tools" }, slug: "weekly" });
    expect(skillSourceOf("weekly", null)).toEqual({ source: { scope: "user" }, slug: "weekly" });
    expect(skillSourceOf("weekly", "/p")).toEqual({ source: { scope: "project", dir: "/p" }, slug: "weekly" });
  });
});

describe("what a mark asks for", () => {
  it("is the measurement's verdict, or not measured without one", () => {
    expect(skillEvalMark(null)).toBe("unmeasured");
    expect(skillEvalMark(measured("w", "s", "t", true))).toBe("helps");
  });

  it("calls for attention when the skill does not help, or was not measured as it is", () => {
    const every: SkillEvalMark[] = ["helps", "hurts", "no-evidence", "pending", "unmeasured"];
    expect(every.filter(needsAttention)).toEqual(["hurts", "no-evidence", "unmeasured"]);
  });

  it("keeps a skill with no evaluation only when conversations use it", () => {
    expect(wantsAttention(null, true)).toBe(true);
    expect(wantsAttention(null, false)).toBe(false);
    expect(wantsAttention("helps", true)).toBe(false);
    expect(wantsAttention("hurts", false)).toBe(true);
  });

  it("keys a project's skill apart from the user's of the same name", () => {
    expect(markKey("weekly", null)).not.toBe(markKey("weekly", "/p"));
    expect(markKey("weekly", "/p")).not.toBe(markKey("weekly", "/q"));
  });
});
