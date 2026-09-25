// /api/blueprints — list packs, start a build, read it, and move it on. A person's decisions come
// through /events; /ask is the route the step's agent is told to use. The split is what each is FOR,
// not an authorisation: both sit behind the same-origin guard, and any local process can call either.
import path from "node:path";
import { stat } from "node:fs/promises";
import type { Express, Response } from "express";
import { z } from "zod";
import { listPacks, loadPackPair, type PackPair } from "./packs.js";
import { writeAnswers } from "./answersFile.js";
import { answerProblems, askedQuestions, hearingAnswersSchema, unansweredQuestions, type HearingAnswers } from "../../common/blueprint/hearing.js";
import { BlueprintRefusal, type BlueprintExecutor, type HumanEvent } from "./executor.js";
import { BLUEPRINT_SLUG_RE } from "../../common/blueprint/manifest.js";

export interface BlueprintRouteDeps {
  executor: BlueprintExecutor;
  packsRoot: string;
  now: () => number;
  /** Whether an agent can start in `dir` without a trust prompt nobody is there to answer. */
  isTrusted: (dir: string) => Promise<boolean>;
}

const createSchema = z.object({
  projectDir: z.string().min(1),
  base: z.string().regex(BLUEPRINT_SLUG_RE),
  usecase: z.string().regex(BLUEPRINT_SLUG_RE),
  answers: hearingAnswersSchema,
});

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve"), stepId: z.string() }),
  z.object({ type: z.literal("reject"), stepId: z.string(), reason: z.string().trim().min(1) }),
  z.object({ type: z.literal("answer"), stepId: z.string(), answer: z.string().trim().min(1) }),
  z.object({ type: z.literal("retry"), stepId: z.string() }),
]);

const askSchema = z.object({ stepId: z.string(), question: z.string().trim().min(1) });

type ParsedEvent = z.infer<typeof eventSchema>;

function humanEventOf(parsed: ParsedEvent, now: number): HumanEvent {
  if (parsed.type === "answer") return { type: "answer", answer: parsed.answer, atMs: now };
  if (parsed.type === "reject") return { type: "reject", reason: parsed.reason };
  return { type: parsed.type };
}

function fail(res: Response, err: unknown): void {
  if (err instanceof BlueprintRefusal) {
    res.status(409).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
}

// A build writes into this directory, so it must be one that already exists, given as an
// absolute path — never resolved against the server's own cwd — and never a filesystem root.
async function projectDirProblem(projectDir: string): Promise<string | null> {
  if (!path.isAbsolute(projectDir) || path.parse(projectDir).root === projectDir) return "projectDir must be an absolute path below the root";
  const info = await stat(projectDir).catch(() => null);
  return info?.isDirectory() ? null : `projectDir is not a directory: ${projectDir}`;
}

function mountReadRoutes(app: Express, deps: BlueprintRouteDeps): void {
  app.get("/api/blueprints/packs", async (_req, res) => {
    res.json({ packs: await listPacks(deps.packsRoot) });
  });

  app.get("/api/blueprints/runs", async (_req, res) => {
    try {
      res.json({ runs: await deps.executor.list() });
    } catch (err) {
      fail(res, err);
    }
  });

  // What the new-build form needs for a base/usecase pair: its interview and the steps it will run.
  app.get("/api/blueprints/pairs/:base/:usecase", async (req, res) => {
    const pair = await loadPackPair(deps.packsRoot, req.params.base, req.params.usecase);
    if (!pair.ok) return res.status(400).json({ error: pair.problems.join("; ") });
    return res.json({ hearing: pair.hearing, steps: pair.steps });
  });

  app.get("/api/blueprints/runs/:id", async (req, res) => {
    try {
      res.json(await deps.executor.view(req.params.id));
    } catch (err) {
      fail(res, err);
    }
  });
}

type CreateRequest = { projectDir: string; answers: HearingAnswers; pair: Extract<PackPair, { ok: true }> };
type Checked = { ok: true; request: CreateRequest } | { ok: false; status: number; error: string };

const refused = (status: number, error: string): Checked => ({ ok: false, status, error });

// Only the questions actually asked are kept, so an answer to a question the conditions closed off
// cannot reach the spec step.
function answersProblem(pair: Extract<PackPair, { ok: true }>, answers: HearingAnswers): string | null {
  const missing = unansweredQuestions(pair.hearing, answers);
  if (missing.length > 0) return `unanswered: ${missing.map((question) => question.id).join(", ")}`;
  const wrong = answerProblems(pair.hearing, answers);
  return wrong.length > 0 ? `invalid: ${wrong.join("; ")}` : null;
}

async function checkCreate(deps: BlueprintRouteDeps, body: unknown): Promise<Checked> {
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return refused(400, "projectDir, base, usecase and answers are required");
  const { projectDir, base, usecase, answers } = parsed.data;
  const dirProblem = await projectDirProblem(projectDir);
  if (dirProblem) return refused(400, dirProblem);
  if (!(await deps.isTrusted(projectDir)))
    return refused(409, `Claude Code does not trust ${projectDir} yet. Open a terminal there once and accept the trust prompt, then start again.`);
  const pair = await loadPackPair(deps.packsRoot, base, usecase);
  if (!pair.ok) return refused(400, pair.problems.join("; "));
  const problem = answersProblem(pair, answers);
  if (problem) return refused(400, problem);
  const asked: HearingAnswers = Object.fromEntries(
    askedQuestions(pair.hearing, answers).flatMap((question) => {
      const answer = answers[question.id];
      return answer === undefined ? [] : [[question.id, answer]];
    }),
  );
  return { ok: true, request: { projectDir, answers: asked, pair } };
}

function mountCreateRoute(app: Express, deps: BlueprintRouteDeps): void {
  app.post("/api/blueprints/runs", async (req, res) => {
    const checked = await checkCreate(deps, req.body);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });
    const { projectDir, answers, pair } = checked.request;
    try {
      await writeAnswers(projectDir, answers);
      const runId = await deps.executor.create({ projectDir, basePackDir: pair.basePackDir, usecasePackDir: pair.usecasePackDir, steps: pair.steps });
      return res.json({ runId });
    } catch (err) {
      return fail(res, err);
    }
  });
}

function mountMoveRoutes(app: Express, deps: BlueprintRouteDeps): void {
  app.post("/api/blueprints/runs/:id/events", async (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "expected { type: approve | reject | answer | retry, stepId, … }" });
    try {
      return res.json(await deps.executor.humanEvent(req.params.id, parsed.data.stepId, humanEventOf(parsed.data, deps.now())));
    } catch (err) {
      return fail(res, err);
    }
  });

  app.post("/api/blueprints/runs/:id/ask", async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "expected { stepId, question }" });
    try {
      await deps.executor.ask(req.params.id, parsed.data.stepId, parsed.data.question);
      return res.json({ ok: true, message: "Asked. Stop now; the answer will come in a new session." });
    } catch (err) {
      return fail(res, err);
    }
  });
}

export function mountBlueprintRoutes(app: Express, deps: BlueprintRouteDeps): void {
  mountReadRoutes(app, deps);
  mountCreateRoute(app, deps);
  mountMoveRoutes(app, deps);
}
