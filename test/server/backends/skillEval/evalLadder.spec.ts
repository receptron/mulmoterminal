// @vitest-environment node
// Searching for the cheapest model that is enough for a skill (#3453), against a fake `claude` whose
// result depends on the model it is started with: the steps run cheapest first, with the skill, on the
// "use" cases only, and stop at the first model that passes everything.
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClaudeRunRequest, ClaudeRunResult } from "../../../../server/backends/skillEval/runClaude";
import type { AttemptDeps } from "../../../../server/backends/skillEval/evalAttempt";
import { skillEvalFolder } from "../../../../server/backends/skillEval/evalStore";
import type { SkillEvalRun } from "../../../../common/skillEval";
import { mountSkillEvalRoutes } from "../../../../server/routes/skill-eval-routes";
import { jsonPost, routeCall } from "../../../helpers/routeCall";
import { finishedSkillEvalRun } from "../../../helpers/finishedSkillEvalRun";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function scratch(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-skill-ladder-"));
  dirs.push(dir);
  return dir;
}

const USE = { kind: "use", prompt: "Do the weekly thing", check: { type: "command", command: "test -f out.txt" } };
const SET = {
  version: 1,
  skill: "weekly",
  repeats: 2,
  ladder: ["cheap", "middle", "dear"],
  cases: [
    { id: "one", title: "One", ...USE },
    { id: "two", title: "Two", ...USE },
    { id: "not-this", title: "Not this", kind: "avoid", prompt: "Something else", check: { type: "command", command: "true" } },
  ],
};

const modelOf = (args: readonly string[]): string => args[args.indexOf("--model") + 1] ?? "";

/** An agent that reads the skill, and writes out.txt only on the models `capable` names. */
function fakeClaude(capable: readonly string[], models: string[]): (request: ClaudeRunRequest) => Promise<ClaudeRunResult> {
  return (request) => {
    const model = modelOf(request.args);
    models.push(model);
    if (capable.includes(model)) writeFileSync(path.join(request.cwd, "out.txt"), "ok");
    const lines = [
      { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Skill", input: { skill: "weekly" } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
      { type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.1, permission_denials: [] },
    ];
    return Promise.resolve({ stdout: lines.map((l) => JSON.stringify(l)).join("\n"), exitCode: 0, failure: null });
  };
}

function setUp(capable: readonly string[], set: unknown = SET) {
  const projectDir = scratch();
  const skillDir = path.join(projectDir, ".claude", "skills", "weekly");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: weekly\n---\nWrite out.txt.\n");
  const root = scratch();
  const evalDir = skillEvalFolder(root, "weekly", projectDir);
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(path.join(evalDir, "cases.json"), JSON.stringify(set));
  const models: string[] = [];
  const deps: Partial<AttemptDeps> = {
    claudeBin: "claude",
    tmpRoot: scratch(),
    runClaude: fakeClaude(capable, models),
    runCommand: async (_command, cwd) => ({ ok: existsSync(path.join(cwd, "out.txt")), output: "" }),
  };
  const server = express();
  server.use(express.json());
  mountSkillEvalRoutes(server, { root, attempt: deps, cwds: () => Promise.resolve([projectDir]) });
  return { call: routeCall(server), fields: { slug: "weekly", dir: projectDir }, evalDir, models };
}

async function search(env: ReturnType<typeof setUp>): Promise<SkillEvalRun | null> {
  const started = await env.call("/api/skill-evals/ladder", jsonPost(env.fields));
  expect(started.status).toBe(202);
  return finishedSkillEvalRun(env.evalDir, String(started.body.id));
}

describe("searching for the cheapest model that is enough", () => {
  it("climbs until a model passes everything, and measures nothing above it", async () => {
    const env = setUp(["middle", "dear"]);
    const run = await search(env);
    expect(run).toMatchObject({ status: "done", ladder: SET.ladder, plannedAttempts: 2 * 2 * 3 });
    expect(env.models).toEqual(["cheap", "cheap", "cheap", "cheap", "middle", "middle", "middle", "middle"]);
    expect(run?.attempts.every((a) => a.arm === "with" && a.caseId !== "not-this")).toBe(true);
    expect(run?.attempts.map((a) => [a.model, a.pass])).toEqual([
      ...Array.from({ length: 4 }, () => ["cheap", false]),
      ...Array.from({ length: 4 }, () => ["middle", true]),
    ]);
  });

  it("stops at the cheapest model when it already passes everything", async () => {
    const env = setUp(["cheap"]);
    expect((await search(env))?.attempts).toHaveLength(4);
    expect(new Set(env.models)).toEqual(new Set(["cheap"]));
  });

  it("measures every model when none passes everything", async () => {
    const env = setUp([]);
    const run = await search(env);
    expect(run?.status).toBe("done");
    expect(run?.attempts).toHaveLength(12);
  });

  it("names the search's size and price, and refuses a set with nothing the skill should help with", async () => {
    const env = setUp([]);
    const overview = await env.call(`/api/skill-evals?slug=weekly&dir=${encodeURIComponent(env.fields.dir)}`);
    expect(overview.body).toMatchObject({ estimate: { ladderAttempts: 12, maxLadderCostUsd: 12 * 0.5 } });
    const avoidOnly = setUp([], { ...SET, cases: [SET.cases[2]] });
    expect((await avoidOnly.call("/api/skill-evals/ladder", jsonPost(avoidOnly.fields))).status).toBe(400);
  });

  it("is never the measurement an improvement starts from", async () => {
    const env = setUp(["cheap"]);
    await search(env);
    expect((await env.call("/api/skill-evals/improve", jsonPost(env.fields))).status).toBe(400);
  });
});
