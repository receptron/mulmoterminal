// @vitest-environment node
// The routes against a fake executor, over real HTTP: what reaches the executor, and how each
// refusal comes back.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { z } from "zod";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { mountBlueprintRoutes } from "../../../server/blueprint/routes";
import { BlueprintRefusal, type BlueprintExecutor } from "../../../server/blueprint/executor";

const PACKS_ROOT = path.join(import.meta.dirname, "..", "..", "..", "blueprints");
const calls: unknown[][] = [];
const trusted = new Set<string>([tmpdir()]);

const executor: BlueprintExecutor = {
  create: async (request) => {
    calls.push(["create", request.projectDir, request.steps.length]);
    return "run-00000001";
  },
  view: async (runId) => {
    throw new BlueprintRefusal(`no blueprint run ${runId}`);
  },
  humanEvent: async (runId, stepId, event) => {
    calls.push(["event", runId, stepId, event]);
    if (stepId === "refused") throw new BlueprintRefusal("cannot approve a step that is pending");
    throw new Error("unexpected");
  },
  ask: async (runId, stepId, question) => {
    calls.push(["ask", runId, stepId, question]);
    throw new BlueprintRefusal("no agent is working on this build");
  },
  list: async () => [],
  recover: async () => undefined,
};

// Every required question of the internal pack, answered: what a filled-in form sends.
const ANSWERS = {
  appName: "Leave requests",
  appPurpose: "Staff request leave; approvers approve it.",
  domain: "example.co.jp",
  workspace: true,
  external: false,
  users: 40,
  roles: ["一般", "承認者"],
  dataSensitivity: "個人情報を含む",
  region: "asia-northeast1（東京）",
  offboarding: true,
  existingProject: false,
  billingAccount: true,
  budget: 10000,
};

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  mountBlueprintRoutes(app, { executor, packsRoot: PACKS_ROOT, now: () => 42, isTrusted: async (dir) => trusted.has(dir) });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => server.close());

const post = async (route: string, body: unknown) => {
  const res = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

describe("POST /api/blueprints/runs", () => {
  it("starts a build of a real pack pair in a trusted directory", async () => {
    calls.length = 0;
    const project = await mkdtemp(path.join(tmpdir(), "blueprint-route-"));
    trusted.add(project);
    const res = await post("/api/blueprints/runs", { projectDir: project, base: "firebase", usecase: "internal", answers: { ...ANSWERS, stray: "x" } });
    expect(res).toEqual({ status: 200, body: { runId: "run-00000001" } });
    expect(calls[0]?.[0]).toBe("create");
    // Only answers to questions that were asked reach the project.
    const written = JSON.parse(await readFile(path.join(project, ".blueprint", "answers.json"), "utf8"));
    expect(written).toEqual(ANSWERS);
    await rm(project, { recursive: true, force: true });
  });

  it("names the questions left unanswered", async () => {
    const rest = Object.fromEntries(Object.entries(ANSWERS).filter(([id]) => id !== "appName"));
    const res = await post("/api/blueprints/runs", { projectDir: tmpdir(), base: "firebase", usecase: "internal", answers: rest });
    expect(res).toEqual({ status: 400, body: { error: "unanswered: appName" } });
  });

  it.each([
    ["a choice the question does not offer", { region: "mars-1" }, "invalid: region: expects one of its options"],
    ["text where a number is asked", { users: "forty" }, "invalid: users: expects a number"],
    ["an unknown role", { roles: ["一般", "superuser"] }, "invalid: roles: expects some of its options"],
  ])("refuses %s", async (_label, patch, error) => {
    const res = await post("/api/blueprints/runs", { projectDir: tmpdir(), base: "firebase", usecase: "internal", answers: { ...ANSWERS, ...patch } });
    expect(res).toEqual({ status: 400, body: { error } });
  });

  it("asks a conditional question once its condition holds", async () => {
    const res = await post("/api/blueprints/runs", { projectDir: tmpdir(), base: "firebase", usecase: "internal", answers: { ...ANSWERS, external: true } });
    expect(res).toEqual({ status: 400, body: { error: "unanswered: externalWho" } });
  });

  it.each([
    ["a relative directory", { projectDir: "app", base: "firebase", usecase: "internal", answers: ANSWERS }, 400],
    ["the filesystem root", { projectDir: "/", base: "firebase", usecase: "internal", answers: ANSWERS }, 400],
    ["a directory that does not exist", { projectDir: path.join(tmpdir(), "no-such-dir-xyz"), base: "firebase", usecase: "internal", answers: ANSWERS }, 400],
    ["a slug with a path in it", { projectDir: tmpdir(), base: "../firebase", usecase: "internal", answers: ANSWERS }, 400],
    ["a usecase on a base it does not support", { projectDir: tmpdir(), base: "internal", usecase: "firebase", answers: ANSWERS }, 400],
    ["no answers at all", { projectDir: tmpdir(), base: "firebase", usecase: "internal" }, 400],
    ["a directory Claude Code does not trust", { projectDir: path.dirname(tmpdir()), base: "firebase", usecase: "internal", answers: ANSWERS }, 409],
  ])("refuses %s", async (_label, body, status) => {
    expect((await post("/api/blueprints/runs", body)).status).toBe(status);
  });
});

describe("GET /api/blueprints/pairs/:base/:usecase", () => {
  it("shows the interview and the composed steps of a real pair", async () => {
    const preview = z
      .object({
        hearing: z.object({ questions: z.array(z.object({ id: z.string() })) }),
        steps: z.array(z.object({ id: z.string(), gates: z.array(z.string()) })),
      })
      .parse(await (await fetch(`${base}/api/blueprints/pairs/firebase/internal`)).json());
    expect(preview.hearing.questions[0].id).toBe("appName");
    // The spec is written first, and read by a person before anything is created in their cloud.
    expect(preview.steps[0].id).toBe("spec");
    expect(preview.steps[1].gates).toContain("review");
  });

  it("refuses a pair that does not compose", async () => {
    expect((await fetch(`${base}/api/blueprints/pairs/internal/firebase`)).status).toBe(400);
  });
});

describe("POST /api/blueprints/runs/:id/events and /ask", () => {
  it("stamps an answer with the server's clock", async () => {
    calls.length = 0;
    await post("/api/blueprints/runs/run-00000001/events", { type: "answer", stepId: "x", answer: "Tokyo" });
    expect(calls).toEqual([["event", "run-00000001", "x", { type: "answer", answer: "Tokyo", atMs: 42 }]]);
  });

  it.each([
    ["an agent-only event", { type: "ask", stepId: "x", question: "q" }],
    ["a check result", { type: "check", stepId: "x", ok: true }],
    ["a reject with no reason", { type: "reject", stepId: "x" }],
    ["a reject whose reason is only spaces", { type: "reject", stepId: "x", reason: "   " }],
    ["an answer that is only spaces", { type: "answer", stepId: "x", answer: "  " }],
  ])("refuses %s on /events", async (_label, body) => {
    expect((await post("/api/blueprints/runs/run-00000001/events", body)).status).toBe(400);
  });

  it("answers a rule refusal with 409 and the reason", async () => {
    expect(await post("/api/blueprints/runs/run-00000001/events", { type: "approve", stepId: "refused" })).toEqual({
      status: 409,
      body: { error: "cannot approve a step that is pending" },
    });
  });

  it("answers 409 to a question nobody is working on", async () => {
    expect((await post("/api/blueprints/runs/run-00000001/ask", { stepId: "x", question: "q" })).status).toBe(409);
  });

  it("answers 409 for a run that does not exist", async () => {
    expect((await fetch(`${base}/api/blueprints/runs/run-00000404`)).status).toBe(409);
  });
});
