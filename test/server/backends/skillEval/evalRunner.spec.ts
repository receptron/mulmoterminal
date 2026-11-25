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
import { judgeApiError, judgeGrade, type AttemptDeps } from "../../../../server/backends/skillEval/evalAttempt";
import { attemptOrder, startEvalRun, stopEvalRun } from "../../../../server/backends/skillEval/evalRunner";
import { listRuns, readEvalSet, readRun, skillEvalFolder, textHash } from "../../../../server/backends/skillEval/evalStore";
import { isBaselineFor, skillEvalSetSchema, type SkillEvalSet } from "../../../../common/skillEval";
import { mountSkillEvalRoutes } from "../../../../server/routes/skill-eval-routes";
import type { LibraryCaller } from "../../../../server/backends/library/library-service";
import { jsonPost, routeCall } from "../../../helpers/routeCall";
import { finishedSkillEvalRun } from "../../../helpers/finishedSkillEvalRun";
import { authorWriteRules } from "../../../../server/backends/skillEval/evalWriteRulesOnDisk.js";

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
  /** The SKILL.md the agent's folder held, or "" without one. */
  skillText: string;
  /** For a grading, whether the skill was still in the folder. */
  judgeSawSkill?: boolean;
}

/** An agent that writes `out.txt` only when the skill is in its folder, and a grader that reads it. */
function fakeClaude(seen: Seen[]): (request: ClaudeRunRequest) => Promise<ClaudeRunResult> {
  return (request) => {
    const isJudge = request.args.includes("--json-schema");
    const skillFile = path.join(request.cwd, ".claude", "skills", "weekly", "SKILL.md");
    if (isJudge) {
      seen.push({ args: request.args, prompt: request.prompt, hadSkill: false, files: [], skillText: "", judgeSawSkill: existsSync(skillFile) });
      const pass = existsSync(path.join(request.cwd, "out.txt"));
      return Promise.resolve({
        stdout: JSON.stringify({ total_cost_usd: 0.01, structured_output: { pass, reasons: ["looked"] } }),
        exitCode: 0,
        failure: null,
      });
    }
    const hadSkill = existsSync(skillFile);
    const skillText = hadSkill ? readFileSync(skillFile, "utf8") : "";
    seen.push({ args: request.args, prompt: request.prompt, hadSkill, files: readdirSync(request.cwd).sort(), skillText });
    if (hadSkill && request.prompt.includes("weekly")) writeFileSync(path.join(request.cwd, "out.txt"), "ok");
    const calls =
      hadSkill && request.prompt.includes("weekly")
        ? [
            { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "weekly" } }] } },
            { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Launching skill: weekly" }] } },
          ]
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
  const evalDir = path.join(root, "weekly");
  mkdirSync(path.join(evalDir, "files", "plain"), { recursive: true });
  writeFileSync(path.join(evalDir, "cases.json"), JSON.stringify(set));
  writeFileSync(path.join(evalDir, "files", "plain", "notes.md"), "notes");
  return { evalDir, skillDir };
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

async function start(evalDir: string, skillDir: string, attemptDeps: AttemptDeps) {
  const read = await readEvalSet(evalDir, "weekly");
  if (read.kind !== "ok") throw new Error("set did not parse");
  const skillText = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  return startEvalRun({ evalDir, set: read.set, setHash: read.hash, skillDir, skillSlug: "weekly", skillText, skillHash: textHash(skillText) }, attemptDeps);
}

describe("a skill evaluation run", () => {
  it("runs every attempt in a fresh, isolated folder and keeps a record of it", async () => {
    const { evalDir, skillDir } = setUp(SET);
    const seen: Seen[] = [];
    const tmpRoot = scratch();
    const started = await start(evalDir, skillDir, deps(seen, tmpRoot));
    await started?.done;
    const run = (await listRuns(evalDir))[0];
    expect(run.status).toBe("done");
    expect(run.attempts).toHaveLength(run.plannedAttempts);
    expect(run.plannedAttempts).toBe((2 * 2 + 1) * 2);
    // The skill is in the folder only with it; the case's files are always there; nothing is left behind.
    const agents = seen.filter((s) => s.judgeSawSkill === undefined);
    expect(agents.filter((s) => s.hadSkill)).toHaveLength(6);
    expect(agents.filter((s) => s.files.includes("notes.md"))).toHaveLength(4);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(seen.every((s) => ["--setting-sources", "project", "--strict-mcp-config"].every((flag) => s.args.includes(flag)))).toBe(true);
    // The skill is named only to the "with" arm of a use case.
    expect(agents.filter((s) => s.prompt.startsWith('Use the "weekly" skill'))).toHaveLength(4);
    // The grader never finds the skill it would otherwise grade by.
    const gradings = seen.filter((s) => s.judgeSawSkill !== undefined);
    expect(gradings).toHaveLength(4);
    expect(gradings.every((s) => s.judgeSawSkill === false)).toBe(true);
    const withPlain = run.attempts.filter((a) => a.caseId === "plain" && a.arm === "with");
    expect(withPlain.every((a) => a.pass && a.skillInvoked)).toBe(true);
    expect(withPlain.map((a) => a.costUsd)).toEqual([0.1, 0.1]);
    expect(run.attempts.filter((a) => a.arm === "without").every((a) => !a.pass)).toBe(true);
    expect(new Set(run.attempts.filter((a) => a.caseId === "judged").map((a) => a.gradingCostUsd))).toEqual(new Set([0.01]));
    expect(run.skillText).toContain("Write out.txt.");
  });

  it("runs one evaluation at a time, and stops after the attempts in flight", async () => {
    const { evalDir, skillDir } = setUp(SET);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = await start(evalDir, skillDir, deps([], scratch(), gate));
    expect(await start(evalDir, skillDir, deps([], scratch()))).toBeNull();
    expect(first).not.toBeNull();
    expect(stopEvalRun(first?.id ?? "")).toBe(true);
    release();
    await first?.done;
    const run = await readRun(evalDir, first?.id ?? "");
    expect(run?.status).toBe("stopped");
    expect(run?.attempts.length).toBeLessThan(run?.plannedAttempts ?? 0);
  });

  it("measures the skill as it was when the run started, whatever is edited meanwhile", async () => {
    const { evalDir, skillDir } = setUp(SET);
    const seen: Seen[] = [];
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = await start(evalDir, skillDir, deps(seen, scratch(), gate));
    writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: weekly\n---\nEdited mid-run.\n");
    release();
    await started?.done;
    const texts = new Set(seen.filter((s) => s.hadSkill).map((s) => s.skillText));
    expect([...texts]).toEqual(["---\nname: weekly\n---\nWrite out.txt.\n"]);
  });

  it("holds the run until every worker has settled when one fails, and starts nothing more", async () => {
    const { evalDir, skillDir } = setUp(SET);
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const failing: AttemptDeps = {
      ...deps([], scratch()),
      runClaude: async () => {
        calls += 1;
        if (calls === 1) throw new Error("claude went away");
        await gate;
        return { stdout: "", exitCode: 0, failure: null };
      },
    };
    const first = await start(evalDir, skillDir, failing);
    await new Promise((r) => setTimeout(r, 20));
    expect(await start(evalDir, skillDir, deps([], scratch()))).toBeNull();
    release();
    await first?.done;
    const run = await readRun(evalDir, first?.id ?? "");
    expect(run).toMatchObject({ status: "interrupted", interruptedBy: "claude went away" });
    expect(calls).toBe(2);
  });

  const UNREACHED = "Failed to authenticate: OAuth session expired and could not be refreshed";
  const unreachedResult = { type: "result", subtype: "success", is_error: true, result: UNREACHED, terminal_reason: "api_error", total_cost_usd: 0 };

  /** `deps`, except that the agent's (or the grader's) every run comes back without reaching the model. */
  function unreachable(who: "agent" | "judge"): AttemptDeps {
    const base = deps([], scratch());
    return {
      ...base,
      runClaude: async (request) => {
        const isJudge = request.args.includes("--json-schema");
        if (isJudge !== (who === "judge")) return base.runClaude(request);
        return { stdout: isJudge ? JSON.stringify(unreachedResult) : stream([unreachedResult]), exitCode: 0, failure: null };
      },
    };
  }

  it("stops, and is no baseline, when the agent or the grader could not reach the model", async () => {
    for (const who of ["agent", "judge"] as const) {
      const { evalDir, skillDir } = setUp(SET);
      const started = await start(evalDir, skillDir, unreachable(who));
      await started?.done;
      const run = await readRun(evalDir, started?.id ?? "");
      if (run === null) throw new Error("no run");
      expect(run).toMatchObject({ status: "interrupted", interruptedBy: UNREACHED });
      expect(isBaselineFor(run, run.setHash, run.skillHash)).toBe(false);
    }
  });

  it("still counts a run that ran out of budget as a failed attempt in a finished run", async () => {
    const { evalDir, skillDir } = setUp(SET);
    const overBudget: AttemptDeps = {
      ...deps([], scratch()),
      runClaude: async () => ({
        stdout: stream([{ type: "result", subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 0.3 }]),
        exitCode: 0,
        failure: null,
      }),
    };
    const started = await start(evalDir, skillDir, overBudget);
    await started?.done;
    const run = await readRun(evalDir, started?.id ?? "");
    expect(run?.status).toBe("done");
    expect(run?.attempts.every((attempt) => !attempt.pass && attempt.error === "the run ended in an error")).toBe(true);
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

  it("reads the grader's answer as unreached only when claude says so", () => {
    expect(judgeApiError(JSON.stringify(unreachedResult))).toBe(UNREACHED);
    expect(judgeApiError(JSON.stringify({ total_cost_usd: 0.2, structured_output: { pass: true, reasons: [] } }))).toBeNull();
    expect(judgeApiError("not json")).toBeNull();
    expect(judgeApiError("[]")).toBeNull();
    expect(judgeApiError("")).toBeNull();
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
    const dir = path.join(scratch(), "weekly");
    expect(await readEvalSet(dir, "weekly")).toEqual({ kind: "absent" });
    mkdirSync(dir);
    writeFileSync(path.join(dir, "cases.json"), "{");
    expect((await readEvalSet(dir, "weekly")).kind).toBe("invalid");
    writeFileSync(path.join(dir, "cases.json"), JSON.stringify({ ...SET, skill: "other" }));
    expect(await readEvalSet(dir, "weekly")).toMatchObject({ kind: "invalid", error: expect.stringContaining('"other"') });
    writeFileSync(path.join(dir, "cases.json"), JSON.stringify(SET));
    expect((await readEvalSet(dir, "weekly")).kind).toBe("ok");
  });

  it("gives a plugin skill a folder without a colon, and each project's skill a folder of its own", () => {
    expect(skillEvalFolder("/r", "tools:weekly", null)).toBe(path.join("/r", "tools__weekly"));
    expect(skillEvalFolder("/r", "weekly", null)).toBe(path.join("/r", "weekly"));
    const a = skillEvalFolder("/r", "weekly", "/work/a");
    expect(a).toMatch(/weekly@[0-9a-f]{8}$/);
    expect(a).not.toBe(skillEvalFolder("/r", "weekly", "/work/b"));
    expect(a).toBe(skillEvalFolder("/r", "weekly", "/work/a"));
  });

  it("reads no run by a name that is not a run id", async () => {
    expect(await readRun(scratch(), "../cases")).toBeNull();
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
    const evalDir = skillEvalFolder(root, "weekly", projectDir);
    if (set !== null) {
      mkdirSync(evalDir, { recursive: true });
      writeFileSync(path.join(evalDir, "cases.json"), JSON.stringify(set));
    }
    return { projectDir, root, evalDir };
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
    const { projectDir, root, evalDir } = project(null);
    const call = app(root, projectDir, []);
    expect((await call(`/api/skill-evals?slug=nope&dir=${encodeURIComponent(projectDir)}`)).status).toBe(404);
    expect((await call("/api/skill-evals/runs", jsonPost({ slug: "weekly", dir: projectDir }))).status).toBe(404);
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(path.join(evalDir, "cases.json"), JSON.stringify({ version: 1, skill: "weekly", cases: [] }));
    expect((await call("/api/skill-evals/runs", jsonPost({ slug: "weekly", dir: projectDir }))).status).toBe(400);
  });

  it("starts the drafting cell in plan mode, in a folder skill's own folder, naming the skill and its file", async () => {
    const { projectDir, root, evalDir } = project(null);
    const spawned: unknown[][] = [];
    const server = express();
    server.use(express.json());
    mountSkillEvalRoutes(server, {
      root,
      cwds: () => Promise.resolve([projectDir]),
      spawnSession: (...args) => (spawned.push(args), Promise.resolve({ sessionId: "s1", agent: "claude", seedRuns: true })),
      // None here: the turn then names no past conversation. Never the real Library from a spec.
      library: () => Promise.resolve([]),
    });
    const answer = await routeCall(server)("/api/skill-evals/author", jsonPost({ slug: "weekly", dir: projectDir }));
    expect(answer.body).toEqual({ chatId: "s1", agent: "claude" });
    const file = path.join(projectDir, ".claude", "skills", "weekly", "SKILL.md");
    expect(spawned).toEqual([
      [
        "claude",
        projectDir,
        `/mulmoterminal-skill-eval skill "weekly", SKILL.md at ${JSON.stringify(file)}, save in ${JSON.stringify(evalDir)}`,
        true,
        null,
        // The save folder is allowed ahead of time, so accepting the plan with auto mode cannot refuse the save (#3507).
        { claudePermissionMode: "plan", claudeAllowedTools: await authorWriteRules(evalDir, root) },
      ],
    ]);
    expect((await app(root, projectDir, [])("/api/skill-evals/author", jsonPost({ slug: "weekly", dir: projectDir }))).status).toBe(503);
  });

  it("asks the drafting cell to talk in the screen's language, and in none it does not know", async () => {
    const { projectDir, root } = project(null);
    const turns: string[] = [];
    const server = express();
    server.use(express.json());
    mountSkillEvalRoutes(server, {
      root,
      cwds: () => Promise.resolve([projectDir]),
      spawnSession: (_agent, _cwd, turn) => (turns.push(turn), Promise.resolve({ sessionId: "s1", agent: "claude", seedRuns: true })),
      library: () => Promise.resolve(["/t/a.jsonl"]),
    });
    const author = (language: unknown) => routeCall(server)("/api/skill-evals/author", jsonPost({ slug: "weekly", dir: projectDir, language }));
    await author("ja");
    await author("zh-TW");
    await author("xx");
    await author(7);
    expect(turns[0]).toMatch(/, past conversations \["\/t\/a\.jsonl"\], reply in Japanese$/);
    expect(turns[1]).toMatch(/, reply in Traditional Chinese$/);
    expect(turns.slice(2).map((turn) => turn.includes("reply in"))).toEqual([false, false]);
  });

  it("names the conversations that ran the skill in its own folder, and none when the Library cannot say", async () => {
    const { projectDir, root } = project(null);
    const turns: string[] = [];
    const asked: unknown[][] = [];
    const call = (library: LibraryCaller) => {
      const server = express();
      server.use(express.json());
      mountSkillEvalRoutes(server, {
        root,
        cwds: () => Promise.resolve([projectDir]),
        spawnSession: (_agent, _cwd, turn) => (turns.push(turn), Promise.resolve({ sessionId: "s1", agent: "claude", seedRuns: true })),
        library,
      });
      return routeCall(server)("/api/skill-evals/author", jsonPost({ slug: "weekly", dir: projectDir }));
    };
    await call((method, args) => (asked.push([method, ...args]), Promise.resolve(["/t/a.jsonl", 7, "/t/b.jsonl"])));
    expect(asked).toEqual([["skillConversations", "weekly", projectDir]]);
    expect(turns[0]).toMatch(/, past conversations \["\/t\/a\.jsonl","\/t\/b\.jsonl"\]$/);
    expect((await call(() => Promise.reject(new Error("the index is not ready")))).status).toBe(200);
    expect((await call(() => Promise.resolve(null))).status).toBe(200);
    expect(turns.slice(1).map((turn) => turn.includes("past conversations"))).toEqual([false, false]);
  });

  it("starts a run and serves it", async () => {
    const { projectDir, root, evalDir } = project(SET);
    const call = app(root, projectDir, []);
    const started = await call("/api/skill-evals/runs", jsonPost({ slug: "weekly", dir: projectDir }));
    expect(started.status).toBe(202);
    const id = String(started.body.id);
    await finishedSkillEvalRun(evalDir, id);
    const run = (await call(`/api/skill-evals/runs/${id}?slug=weekly&dir=${encodeURIComponent(projectDir)}`)).body;
    expect(run).toMatchObject({ status: "done", plannedAttempts: 10 });
    expect(run.attempts).toHaveLength(10);
    expect((await call(`/api/skill-evals/runs/${id}/stop`, jsonPost({}))).status).toBe(404);
  });
});
