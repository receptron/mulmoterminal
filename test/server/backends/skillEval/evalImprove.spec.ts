// @vitest-environment node
// Improving a skill from its evaluation (#3448), against a fake `claude`: the report the writer reads,
// writing the improvement into its own folder without touching the skill, measuring it, the ways writing
// fails, which run an improvement starts from, and adopting one over the skill with the old text kept.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClaudeRunRequest, ClaudeRunResult } from "../../../../server/backends/skillEval/runClaude";
import type { AttemptDeps } from "../../../../server/backends/skillEval/evalAttempt";
import { candidateDir, improvePrompt, improveReport } from "../../../../server/backends/skillEval/evalImprove";
import { readRun, skillEvalFolder } from "../../../../server/backends/skillEval/evalStore";
import { isBaselineFor, type SkillEvalAttempt, type SkillEvalRun } from "../../../../common/skillEval";
import { mountSkillEvalRoutes } from "../../../../server/routes/skill-eval-routes";
import { jsonPost, routeCall } from "../../../helpers/routeCall";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-skill-improve-"));
  dirs.push(dir);
  return dir;
}

const ORIGINAL = "---\nname: weekly\n---\nWrite notes.\n";
const IMPROVED = "---\nname: weekly\n---\nWrite out.txt.\n";
const SET = {
  version: 1,
  skill: "weekly",
  repeats: 1,
  cases: [{ id: "plain", title: "Plain", kind: "use", prompt: "Do the weekly thing", check: { type: "command", command: "test -f out.txt" } }],
};

const stream = (lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join("\n");
const result = (text: string, cost: number) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: text,
  total_cost_usd: cost,
  permission_denials: [],
});

type Writer = (cwd: string) => ClaudeRunResult;
const improvesIt: Writer = (cwd) => {
  writeFileSync(path.join(cwd, "skill", "SKILL.md"), IMPROVED);
  return { stdout: stream([result("Said which file to write.", 0.3)]), exitCode: 0, failure: null };
};

/** A writer as `writer` says; an agent that writes out.txt only when its skill says so. */
function fakeClaude(writer: Writer, prompts: string[]): (request: ClaudeRunRequest) => Promise<ClaudeRunResult> {
  return (request) => {
    prompts.push(request.prompt);
    if (existsSync(path.join(request.cwd, "eval-report.md"))) return Promise.resolve(writer(request.cwd));
    const skillFile = path.join(request.cwd, ".claude", "skills", "weekly", "SKILL.md");
    const skill = existsSync(skillFile) ? readFileSync(skillFile, "utf8") : "";
    if (skill.includes("out.txt")) writeFileSync(path.join(request.cwd, "out.txt"), "ok");
    const calls = skill
      ? [
          { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "weekly" } }] } },
          { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
        ]
      : [];
    return Promise.resolve({ stdout: stream([...calls, result("done", 0.1)]), exitCode: 0, failure: null });
  };
}

function setUp(writer: Writer = improvesIt) {
  const projectDir = scratch();
  const skillDir = path.join(projectDir, ".claude", "skills", "weekly");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), ORIGINAL);
  const root = scratch();
  const evalDir = skillEvalFolder(root, "weekly", projectDir);
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(path.join(evalDir, "cases.json"), JSON.stringify(SET));
  const prompts: string[] = [];
  const tmpRoot = scratch();
  const deps: Partial<AttemptDeps> = {
    claudeBin: "claude",
    tmpRoot,
    runClaude: fakeClaude(writer, prompts),
    runCommand: async (_command, cwd) => ({ ok: existsSync(path.join(cwd, "out.txt")), output: "" }),
  };
  const server = express();
  server.use(express.json());
  mountSkillEvalRoutes(server, { root, attempt: deps, cwds: () => Promise.resolve([projectDir]) });
  const call = routeCall(server);
  const fields = { slug: "weekly", dir: projectDir };
  return { call, fields, evalDir, skillDir, prompts, tmpRoot };
}

async function finished(evalDir: string, id: string): Promise<SkillEvalRun | null> {
  for (let i = 0; i < 100 && (await readRun(evalDir, id))?.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  return readRun(evalDir, id);
}

async function measure(env: ReturnType<typeof setUp>, url: string): Promise<SkillEvalRun | null> {
  const started = await env.call(url, jsonPost(env.fields));
  expect(started.status).toBe(202);
  return finished(env.evalDir, String(started.body.id));
}

describe("improving a skill", () => {
  it("refuses until the skill has been measured with these tasks", async () => {
    const env = setUp();
    expect((await env.call("/api/skill-evals/improve", jsonPost(env.fields))).status).toBe(400);
  });

  it("writes the improvement into its own folder, measures it, and leaves the skill alone", async () => {
    const env = setUp();
    const baseline = await measure(env, "/api/skill-evals/runs");
    expect(baseline?.attempts.find((a) => a.arm === "with")?.pass).toBe(false);
    const improved = await measure(env, "/api/skill-evals/improve");
    expect(improved).toMatchObject({ status: "done", skillText: IMPROVED, note: "Said which file to write.", improveCostUsd: 0.3 });
    expect(improved?.candidateId).toBe(improved?.id);
    expect(improved?.attempts.find((a) => a.arm === "with")?.pass).toBe(true);
    expect(readFileSync(path.join(candidateDir(env.evalDir, improved?.id ?? ""), "SKILL.md"), "utf8")).toBe(IMPROVED);
    expect(readFileSync(path.join(env.skillDir, "SKILL.md"), "utf8")).toBe(ORIGINAL);
    expect(readdirSync(env.tmpRoot)).toEqual([]);
  });

  it("ends the run with the reason when the writer changed nothing or failed", async () => {
    const unchanged = setUp(() => ({ stdout: stream([result("Nothing to do.", 0.2)]), exitCode: 0, failure: null }));
    await measure(unchanged, "/api/skill-evals/runs");
    expect(await measure(unchanged, "/api/skill-evals/improve")).toMatchObject({
      status: "interrupted",
      note: "the improvement changed nothing",
      improveCostUsd: 0.2,
      attempts: [],
    });
    const broken = setUp(() => ({ stdout: "", exitCode: null, failure: "claude ran longer than 600000 ms" }));
    await measure(broken, "/api/skill-evals/runs");
    expect(await measure(broken, "/api/skill-evals/improve")).toMatchObject({ status: "interrupted", note: "claude ran longer than 600000 ms" });
  });

  it("adopts a measured improvement over the skill, keeping the text it replaced", async () => {
    const env = setUp();
    await measure(env, "/api/skill-evals/runs");
    const improved = await measure(env, "/api/skill-evals/improve");
    const adopted = await env.call("/api/skill-evals/adopt", jsonPost({ ...env.fields, runId: improved?.id }));
    expect(adopted.status).toBe(200);
    expect(readFileSync(path.join(env.skillDir, "SKILL.md"), "utf8")).toBe(IMPROVED);
    expect(readFileSync(String(adopted.body.backup), "utf8")).toBe(ORIGINAL);
  });

  it("refuses to adopt a run that measured the skill itself, or one that is not there", async () => {
    const env = setUp();
    const baseline = await measure(env, "/api/skill-evals/runs");
    expect((await env.call("/api/skill-evals/adopt", jsonPost({ ...env.fields, runId: baseline?.id }))).status).toBe(400);
    expect((await env.call("/api/skill-evals/adopt", jsonPost({ ...env.fields, runId: "1795000000000-deadbeef" }))).status).toBe(404);
    expect(readFileSync(path.join(env.skillDir, "SKILL.md"), "utf8")).toBe(ORIGINAL);
  });

  it("refuses to adopt an improvement whose text or tasks changed after it was measured", async () => {
    const edited = setUp();
    await measure(edited, "/api/skill-evals/runs");
    const tampered = await measure(edited, "/api/skill-evals/improve");
    writeFileSync(path.join(candidateDir(edited.evalDir, tampered?.id ?? ""), "SKILL.md"), "unmeasured");
    expect((await edited.call("/api/skill-evals/adopt", jsonPost({ ...edited.fields, runId: tampered?.id }))).status).toBe(400);
    expect(readFileSync(path.join(edited.skillDir, "SKILL.md"), "utf8")).toBe(ORIGINAL);
    const retasked = setUp();
    await measure(retasked, "/api/skill-evals/runs");
    const stale = await measure(retasked, "/api/skill-evals/improve");
    writeFileSync(path.join(retasked.evalDir, "cases.json"), JSON.stringify({ ...SET, repeats: 2 }));
    expect((await retasked.call("/api/skill-evals/adopt", jsonPost({ ...retasked.fields, runId: stale?.id }))).status).toBe(400);
    expect(readFileSync(path.join(retasked.skillDir, "SKILL.md"), "utf8")).toBe(ORIGINAL);
  });

  it("refuses to adopt over an edit made to the skill after the improvement was written", async () => {
    const env = setUp();
    await measure(env, "/api/skill-evals/runs");
    const improved = await measure(env, "/api/skill-evals/improve");
    writeFileSync(path.join(env.skillDir, "SKILL.md"), "edited by hand");
    expect((await env.call("/api/skill-evals/adopt", jsonPost({ ...env.fields, runId: improved?.id }))).status).toBe(409);
    expect(readFileSync(path.join(env.skillDir, "SKILL.md"), "utf8")).toBe("edited by hand");
  });

  it.skipIf(process.platform === "win32")("writes nothing through a linked SKILL.md, and keeps no link the writer made", async () => {
    const env = setUp((cwd) => {
      symlinkSync("/etc/hosts", path.join(cwd, "skill", "hosts"));
      return improvesIt(cwd);
    });
    const target = path.join(scratch(), "real.md");
    writeFileSync(target, ORIGINAL);
    unlinkSync(path.join(env.skillDir, "SKILL.md"));
    symlinkSync(target, path.join(env.skillDir, "SKILL.md"));
    await measure(env, "/api/skill-evals/runs");
    const improved = await measure(env, "/api/skill-evals/improve");
    expect(improved?.status).toBe("done");
    expect(readFileSync(target, "utf8")).toBe(ORIGINAL);
    expect(lstatSync(path.join(candidateDir(env.evalDir, improved?.id ?? ""), "SKILL.md")).isSymbolicLink()).toBe(false);
    expect(existsSync(path.join(candidateDir(env.evalDir, improved?.id ?? ""), "hosts"))).toBe(false);
  });

  it("finds the measurement to start from past the listed runs, and not once the skill was edited", async () => {
    const env = setUp();
    const baseline = await measure(env, "/api/skill-evals/runs");
    const later = Array.from({ length: 25 }, (_, i) => ({ ...baseline, id: `1999999999${String(100 + i)}-aaaaaaaa`, candidateId: "x" }));
    later.forEach((laterRun) => writeFileSync(path.join(env.evalDir, "runs", `${laterRun.id}.json`), JSON.stringify(laterRun)));
    const query = `/api/skill-evals?slug=weekly&dir=${encodeURIComponent(env.fields.dir)}`;
    expect((await env.call(query)).body).toMatchObject({ baseline: { id: baseline?.id } });
    const improved = await measure(env, "/api/skill-evals/improve");
    expect(improved?.baseRunId).toBe(baseline?.id);
    writeFileSync(path.join(env.skillDir, "SKILL.md"), "edited by hand");
    expect((await env.call(query)).body).toMatchObject({ baseline: null });
    expect((await env.call("/api/skill-evals/improve", jsonPost(env.fields))).status).toBe(400);
  });

  it("says whether the skill may be written over", async () => {
    const env = setUp();
    const overview = await env.call(`/api/skill-evals?slug=weekly&dir=${encodeURIComponent(env.fields.dir)}`);
    expect(overview.body).toMatchObject({ editable: true, estimate: { maxImproveCostUsd: 1 + 2 * 0.5 } });
  });
});

describe("what the writer is given", () => {
  const attempt = (arm: "with" | "without", pass: boolean, extra: Partial<SkillEvalAttempt> = {}): SkillEvalAttempt => ({
    ...{ caseId: "plain", arm, round: 0, pass, skillInvoked: arm === "with", costUsd: 0, gradingCostUsd: 0, durationMs: 0 },
    ...{ finalText: "", checkOutput: "", denied: [], error: null },
    ...extra,
  });
  const run = (attempts: SkillEvalAttempt[], extra: Partial<SkillEvalRun> = {}): SkillEvalRun => ({
    ...{ id: "1795000000000-aaaaaaaa", skill: "weekly", status: "done", startedAt: 1, finishedAt: 2, model: "haiku", repeats: 1 },
    ...{ skillText: ORIGINAL, skillHash: "h", setHash: "s", cases: SET.cases as SkillEvalRun["cases"], plannedAttempts: 2 },
    ...{ attempts, candidateId: null, note: "", improveCostUsd: 0, baseSkillHash: "", baseRunId: null },
    ...extra,
  });

  it("reports each case's request, its check, and each attempt with why it failed and whether the skill was read", () => {
    const report = improveReport(run([attempt("with", false, { skillInvoked: false, checkOutput: "check exited with 1" }), attempt("without", true)]));
    expect(report).toContain("Request: Do the weekly thing");
    expect(report).toContain("command `test -f out.txt`");
    expect(report).toContain("with skill, round 1: FAIL, skill NOT read — check exited with 1");
    expect(report).toContain("without skill, round 1: pass");
  });

  it("tells the writer not to fit the test tasks, to stay short and to fix an unread description", () => {
    const prompt = improvePrompt();
    expect(prompt).toContain("Do NOT mention, quote or special-case the test tasks");
    expect(prompt).toContain("Keep the body short");
    expect(prompt).toContain("description");
  });

  it("starts only from a finished measurement of the skill itself, as its text is now, on the current tasks", () => {
    const measured = [attempt("with", true)];
    expect(isBaselineFor(run(measured), "s", "h")).toBe(true);
    expect(isBaselineFor(run(measured, { candidateId: "b" }), "s", "h")).toBe(false);
    expect(isBaselineFor(run(measured, { setHash: "other" }), "s", "h")).toBe(false);
    expect(isBaselineFor(run(measured), "s", "edited")).toBe(false);
    expect(isBaselineFor(run(measured, { status: "stopped" }), "s", "h")).toBe(false);
    expect(isBaselineFor(run([]), "s", "h")).toBe(false);
  });
});
