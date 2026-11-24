// @vitest-environment node
// A whole skill evaluation against a fake `claude` (#3438): what each attempt's folder holds, the
// isolation flags, grading by command and by rubric, the record on disk, one run at a time, stopping,
// and the routes that drive it.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClaudeRunRequest, ClaudeRunResult } from "../../../../server/backends/skillEval/runClaude";
import { judgeGrade, type AttemptDeps } from "../../../../server/backends/skillEval/evalAttempt";
import { attemptOrder, startEvalRun, stopEvalRun } from "../../../../server/backends/skillEval/evalRunner";
import { listRuns, readEvalSet, readRun, textHash } from "../../../../server/backends/skillEval/evalStore";
import { skillEvalSetSchema, type SkillEvalSet } from "../../../../common/skillEval";
import { mountSkillEvalRoutes } from "../../../../server/routes/skill-eval-routes";
import { jsonPost, routeCall } from "../../../helpers/routeCall";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-skill-eval-"));
  dirs.push(dir);
  return dir;
}

const stream = (lines: unknown[]): string => lines.map((l) => JSON.stringify(l)).join("\n");

interface Seen {
  args: string[];
  prompt: string;
  hadSkill: boolean;
  files: string[];
}

/** An agent that writes `out.txt` only when the skill is in its folder, and a grader that reads it. */
function fakeClaude(seen: Seen[]): (request: ClaudeRunRequest) => Promise<ClaudeRunResult> {
  return (request) => {
    const isJudge = request.args.includes("--json-schema");
    if (isJudge) {
      const pass = existsSync(path.join(request.cwd, "out.txt"));
      return Promise.resolve({
        stdout: JSON.stringify({ total_cost_usd: 0.01, structured_output: { pass, reasons: ["looked"] } }),
        exitCode: 0,
        failure: null,
      });
    }
    const hadSkill = existsSync(path.join(request.cwd, ".claude", "skills", "weekly", "SKILL.md"));
    seen.push({ args: request.args, prompt: request.prompt, hadSkill, files: readdirSync(request.cwd).sort() });
    if (hadSkill && request.prompt.includes("weekly")) writeFileSync(path.join(request.cwd, "out.txt"), "ok");
    const calls =
      hadSkill && request.prompt.includes("weekly")
        ? [{ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "weekly" } }] } }]
        : [];
    const result = { type: "result", subtype: "success", is_error: false, result: "finished", total_cost_usd: 0.1, permission_denials: [] };
    return Promise.resolve({ stdout: stream([...calls, result]), exitCode: 0, failure: null });
  };
}

function setUp(set: Record<string, unknown>) {
  const root = scratch();
  const skillDir = path.join(scratch(), "weekly");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: weekly\n---\nWrite out.txt.\n");
  mkdirSync(path.join(root, "weekly", "files", "plain"), { recursive: true });
  writeFileSync(path.join(root, "weekly", "cases.json"), JSON.stringify(set));
  writeFileSync(path.join(root, "weekly", "files", "plain", "notes.md"), "notes");
  return { root, skillDir };
}

const SET = {
  version: 1,
  skill: "weekly",
  repeats: 2,
  cases: [
    { id: "plain", title: "plain", kind: "use", prompt: "Write out.txt", check: { type: "command", command: "test -f out.txt" } },
    { id: "judged", title: "judged", kind: "use", prompt: "Write out.txt", check: { type: "rubric", items: ["out.txt exists"] } },
    { id: "other", title: "other", kind: "avoid", prompt: "Say hi", check: { type: "command", command: "true" } },
  ],
};

function deps(seen: Seen[], tmpRoot: string, gate?: Promise<void>): AttemptDeps {
  const claude = fakeClaude(seen);
  return {
    ...{ claudeBin: "claude", tmpRoot, now: () => 1_795_000_000_000 },
    runClaude: async (request) => {
      await gate;
      return claude(request);
    },
    runCommand: async (command, cwd) => ({ ok: command === "true" || existsSync(path.join(cwd, "out.txt")), output: command }),
  };
}

async function start(root: string, skillDir: string, attemptDeps: AttemptDeps) {
  const read = await readEvalSet(root, "weekly");
  if (read.kind !== "ok") throw new Error("set did not parse");
  const skillText = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  return startEvalRun({ root, set: read.set, setHash: read.hash, skillDir, skillSlug: "weekly", skillText, skillHash: textHash(skillText) }, attemptDeps);
}

describe("a skill evaluation run", () => {
  it("runs every attempt in a fresh, isolated folder and keeps a record of it", async () => {
    const { root, skillDir } = setUp(SET);
    const seen: Seen[] = [];
    const tmpRoot = scratch();
    const started = await start(root, skillDir, deps(seen, tmpRoot));
    await started?.done;
    const run = (await listRuns(root, "weekly"))[0];
    expect(run.status).toBe("done");
    expect(run.attempts).toHaveLength(run.plannedAttempts);
    expect(run.plannedAttempts).toBe((2 * 2 + 1) * 2);
    // The skill is in the folder only with it; the case's files are always there; nothing is left behind.
    expect(seen.filter((s) => s.hadSkill)).toHaveLength(6);
    expect(seen.filter((s) => s.files.includes("notes.md"))).toHaveLength(4);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(seen.every((s) => ["--setting-sources", "project", "--strict-mcp-config"].every((flag) => s.args.includes(flag)))).toBe(true);
    // The skill is named only to the "with" arm of a use case.
    expect(seen.filter((s) => s.prompt.startsWith('Use the "weekly" skill'))).toHaveLength(4);
    const withPlain = run.attempts.filter((a) => a.caseId === "plain" && a.arm === "with");
    expect(withPlain.every((a) => a.pass && a.skillInvoked)).toBe(true);
    expect(withPlain.map((a) => a.costUsd)).toEqual([0.1, 0.1]);
    expect(run.attempts.filter((a) => a.arm === "without").every((a) => !a.pass)).toBe(true);
    expect(new Set(run.attempts.filter((a) => a.caseId === "judged").map((a) => a.gradingCostUsd))).toEqual(new Set([0.01]));
    expect(run.skillText).toContain("Write out.txt.");
  });

  it("runs one evaluation at a time, and stops after the attempts in flight", async () => {
    const { root, skillDir } = setUp(SET);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = await start(root, skillDir, deps([], scratch(), gate));
    expect(await start(root, skillDir, deps([], scratch()))).toBeNull();
    expect(first).not.toBeNull();
    expect(stopEvalRun(first?.id ?? "")).toBe(true);
    release();
    await first?.done;
    const run = await readRun(root, "weekly", first?.id ?? "");
    expect(run?.status).toBe("stopped");
    expect(run?.attempts.length).toBeLessThan(run?.plannedAttempts ?? 0);
  });

  it("orders attempts round by round", () => {
    const set: SkillEvalSet = skillEvalSetSchema.parse(SET);
    expect(attemptOrder(set).map((a) => `${a.evalCase.id}/${a.arm}/${String(a.round)}`)).toEqual([
      "plain/with/0",
      "plain/without/0",
      "judged/with/0",
      "judged/without/0",
      "other/with/0",
      "plain/with/1",
      "plain/without/1",
      "judged/with/1",
      "judged/without/1",
      "other/with/1",
    ]);
  });

  it("fails a grade the grader did not give", () => {
    expect(judgeGrade("not json")).toMatchObject({ pass: false });
    expect(judgeGrade(JSON.stringify({ total_cost_usd: 0.2, structured_output: { reasons: [] } }))).toEqual({
      pass: false,
      output: "the grader gave no verdict",
      costUsd: 0.2,
    });
  });
});

describe("the set on disk", () => {
  it("is absent, invalid, for another skill, or read", async () => {
    const root = scratch();
    expect(await readEvalSet(root, "weekly")).toEqual({ kind: "absent" });
    mkdirSync(path.join(root, "weekly"));
    writeFileSync(path.join(root, "weekly", "cases.json"), "{");
    expect((await readEvalSet(root, "weekly")).kind).toBe("invalid");
    writeFileSync(path.join(root, "weekly", "cases.json"), JSON.stringify({ ...SET, skill: "other" }));
    expect(await readEvalSet(root, "weekly")).toMatchObject({ kind: "invalid", error: expect.stringContaining('"other"') });
    writeFileSync(path.join(root, "weekly", "cases.json"), JSON.stringify(SET));
    expect((await readEvalSet(root, "weekly")).kind).toBe("ok");
  });

  it("keeps a plugin skill's set under a name without a colon", async () => {
    const root = scratch();
    mkdirSync(path.join(root, "tools__weekly"));
    writeFileSync(path.join(root, "tools__weekly", "cases.json"), JSON.stringify({ ...SET, skill: "tools:weekly" }));
    expect((await readEvalSet(root, "tools:weekly")).kind).toBe("ok");
  });

  it("reads no run by a name that is not a run id", async () => {
    expect(await readRun(scratch(), "weekly", "../cases")).toBeNull();
  });
});

describe("/api/skill-evals", () => {
  function app(root: string, skillsRoot: string, seen: Seen[]) {
    const server = express();
    server.use(express.json());
    mountSkillEvalRoutes(server, { root, attempt: deps(seen, scratch()), cwds: () => Promise.resolve([skillsRoot]) });
    return routeCall(server);
  }

  /** A project skill, so the route resolves it under `<dir>/.claude/skills`. */
  function project(set: Record<string, unknown> | null) {
    const projectDir = scratch();
    const skillDir = path.join(projectDir, ".claude", "skills", "weekly");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: weekly\n---\nWrite out.txt.\n");
    const root = scratch();
    if (set !== null) {
      mkdirSync(path.join(root, "weekly"));
      writeFileSync(path.join(root, "weekly", "cases.json"), JSON.stringify(set));
    }
    return { projectDir, root };
  }

  it("answers what is set up, with the estimate, and no set when there is none", async () => {
    const { projectDir, root } = project(SET);
    const call = app(root, projectDir, []);
    const answer = (await call(`/api/skill-evals?slug=weekly&dir=${encodeURIComponent(projectDir)}`)).body;
    expect(answer).toMatchObject({ skill: "weekly", setError: null, estimate: { attempts: 10 }, runs: [], activeRunId: null });
    const bare = project(null);
    expect((await app(bare.root, bare.projectDir, [])(`/api/skill-evals?slug=weekly&dir=${encodeURIComponent(bare.projectDir)}`)).body).toMatchObject({
      set: null,
      estimate: null,
    });
  });

  it("refuses a skill it cannot find, a missing set and an invalid one", async () => {
    const { projectDir, root } = project(null);
    const call = app(root, projectDir, []);
    expect((await call(`/api/skill-evals?slug=nope&dir=${encodeURIComponent(projectDir)}`)).status).toBe(404);
    expect((await call("/api/skill-evals/runs", jsonPost({ slug: "weekly", dir: projectDir }))).status).toBe(404);
    mkdirSync(path.join(root, "weekly"));
    writeFileSync(path.join(root, "weekly", "cases.json"), JSON.stringify({ version: 1, skill: "weekly", cases: [] }));
    expect((await call("/api/skill-evals/runs", jsonPost({ slug: "weekly", dir: projectDir }))).status).toBe(400);
  });

  it("starts the drafting cell in plan mode, in a folder skill's own folder, naming the skill and its file", async () => {
    const { projectDir, root } = project(null);
    const spawned: unknown[][] = [];
    const server = express();
    server.use(express.json());
    mountSkillEvalRoutes(server, {
      root,
      cwds: () => Promise.resolve([projectDir]),
      spawnSession: (...args) => (spawned.push(args), Promise.resolve({ sessionId: "s1", agent: "claude", seedRuns: true })),
    });
    const answer = await routeCall(server)("/api/skill-evals/author", jsonPost({ slug: "weekly", dir: projectDir }));
    expect(answer.body).toEqual({ chatId: "s1", agent: "claude" });
    const file = path.join(projectDir, ".claude", "skills", "weekly", "SKILL.md");
    expect(spawned).toEqual([["claude", projectDir, `/mulmoterminal-skill-eval weekly ${file}`, true, null, { claudePermissionMode: "plan" }]]);
    expect((await app(root, projectDir, [])("/api/skill-evals/author", jsonPost({ slug: "weekly", dir: projectDir }))).status).toBe(503);
  });

  it("starts a run and serves it", async () => {
    const { projectDir, root } = project(SET);
    const call = app(root, projectDir, []);
    const started = await call("/api/skill-evals/runs", jsonPost({ slug: "weekly", dir: projectDir }));
    expect(started.status).toBe(202);
    const id = String(started.body.id);
    for (let i = 0; i < 50 && (await readRun(root, "weekly", id))?.status === "running"; i++) await new Promise((r) => setTimeout(r, 20));
    const run = (await call(`/api/skill-evals/runs/${id}?slug=weekly&dir=${encodeURIComponent(projectDir)}`)).body;
    expect(run).toMatchObject({ status: "done", plannedAttempts: 10 });
    expect(run.attempts).toHaveLength(10);
    expect((await call(`/api/skill-evals/runs/${id}/stop`, jsonPost({}))).status).toBe(404);
  });
});
