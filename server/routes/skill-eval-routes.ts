// Skill evaluations over HTTP (#3438): what is set up for a skill and its past runs, one run in full,
// starting a run and stopping it. The skill is named the way the Skills viewer names it (slug plus
// plugin or dir); the cases and their checks come from the file the user approved, never from a
// request, since a check is a shell command.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Express, Response } from "express";
import { MULMOTERMINAL_HOME } from "../config/env.js";
import { claudeAdapter } from "../agents/claude/claude.js";
import { rememberedSessionCwds } from "../session/registry.js";
import { skillDocFile, type SkillDocSource } from "../backends/skills/skillCatalog.js";
import { maxRunCostUsd, plannedAttempts, SKILL_EVAL_AUTHOR_SKILL, type SkillEvalRun } from "../../common/skillEval.js";
import type { SpawnIssueSession } from "../session/spawn/issue-session-spawn.js";
import { commandRunner, type AttemptDeps } from "../backends/skillEval/evalAttempt.js";
import { runClaude } from "../backends/skillEval/runClaude.js";
import { listRuns, readEvalSet, readRun, skillEvalDir, textHash } from "../backends/skillEval/evalStore.js";
import { activeRunId, effectiveStatus, startEvalRun, stopEvalRun } from "../backends/skillEval/evalRunner.js";
import { docSource } from "./skill-source-query.js";
import { requestBody } from "./requestBody.js";
import { homedir, tmpdir } from "node:os";

export const SKILL_EVALS_ROOT = path.join(MULMOTERMINAL_HOME, "skill-evals");

export interface SkillEvalRouteDeps {
  root?: string;
  attempt?: Partial<AttemptDeps>;
  cwds?: () => Promise<string[]>;
  /** Starts the Claude cell that drafts a set with the user; without it, that answers 503. */
  spawnSession?: SpawnIssueSession;
}

const skillIdOf = (source: SkillDocSource, slug: string): string => (source.scope === "plugin" ? `${source.plugin}:${slug}` : slug);

/** A record still marked running that this server is not running says it was interrupted. */
const runView = (run: SkillEvalRun): SkillEvalRun => ({ ...run, status: effectiveStatus(run) });

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

interface ResolvedSkill {
  id: string;
  slug: string;
  file: string;
  source: SkillDocSource;
}

async function resolveSkill(query: Record<string, unknown>, cwds: () => Promise<string[]>): Promise<ResolvedSkill | null> {
  const slug = typeof query.slug === "string" ? query.slug : "";
  const source = docSource(query);
  const file = await skillDocFile({ source, slug, cwds: await cwds() });
  if (file === null || !(await isFile(file))) return null;
  return { id: skillIdOf(source, slug), slug, file, source };
}

const fail = (res: Response, status: number, error: string): void => {
  res.status(status).json({ error });
};
const SKILL_NOT_FOUND = "skill not found";

interface Context {
  root: string;
  cwds: () => Promise<string[]>;
  attemptDeps: AttemptDeps;
  spawnSession: SpawnIssueSession | null;
}

// Plan mode, as for the Library's promote: the skill shows its draft and writes nothing until the user
// approves, and Claude Code holds that rather than the skill's own wording.
const AUTHOR_PERMISSION_MODE = "plan";

/** The first turn of the drafting cell: the skill's name and where its SKILL.md is. */
export const authorTurn = (skillId: string, file: string): string => `/${SKILL_EVAL_AUTHOR_SKILL} ${skillId} ${file}`;

async function startAuthoring(ctx: Context, body: Record<string, unknown>, res: Response): Promise<void> {
  if (ctx.spawnSession === null) return fail(res, 503, "sessions cannot be started here");
  const skill = await resolveSkill(body, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  // A folder's skill is drafted in that folder; the user's and a plugin's anywhere, so the home.
  const cwd = skill.source.scope === "project" ? skill.source.dir : homedir();
  try {
    const spawned = await ctx.spawnSession("claude", cwd, authorTurn(skill.id, skill.file), true, null, { claudePermissionMode: AUTHOR_PERMISSION_MODE });
    res.json({ chatId: spawned.sessionId, agent: spawned.agent });
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : "the session could not be started");
  }
}

async function overview(ctx: Context, query: Record<string, unknown>, res: Response): Promise<void> {
  const skill = await resolveSkill(query, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const read = await readEvalSet(ctx.root, skill.id);
  const set = read.kind === "ok" ? read.set : null;
  res.json({
    ...{ skill: skill.id, dir: skillEvalDir(ctx.root, skill.id), set, setError: read.kind === "invalid" ? read.error : null },
    estimate: set === null ? null : { attempts: plannedAttempts(set), maxCostUsd: maxRunCostUsd(set) },
    ...{ runs: (await listRuns(ctx.root, skill.id)).map(runView), activeRunId: activeRunId(skill.id) },
  });
}

async function oneRun(ctx: Context, query: Record<string, unknown>, runId: string, res: Response): Promise<void> {
  const skill = await resolveSkill(query, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const run = await readRun(ctx.root, skill.id, runId);
  if (run === null) return fail(res, 404, "run not found");
  res.json(runView(run));
}

async function startRun(ctx: Context, body: Record<string, unknown>, res: Response): Promise<void> {
  const skill = await resolveSkill(body, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const read = await readEvalSet(ctx.root, skill.id);
  if (read.kind === "absent") return fail(res, 404, "no evaluation is set up for this skill");
  if (read.kind === "invalid") return fail(res, 400, read.error);
  const skillText = await readFile(skill.file, "utf8");
  const skillDir = path.dirname(skill.file);
  const start = { root: ctx.root, set: read.set, setHash: read.hash, skillDir, skillSlug: skill.slug, skillText, skillHash: textHash(skillText) };
  const started = await startEvalRun(start, ctx.attemptDeps);
  if (started === null) return fail(res, 409, "another evaluation is running");
  res.status(202).json({ id: started.id });
}

export function mountSkillEvalRoutes(app: Express, deps: SkillEvalRouteDeps = {}): void {
  const ctx: Context = {
    root: deps.root ?? SKILL_EVALS_ROOT,
    cwds: deps.cwds ?? rememberedSessionCwds,
    attemptDeps: { claudeBin: claudeAdapter.bin(), runClaude, runCommand: commandRunner, tmpRoot: tmpdir(), now: Date.now, ...deps.attempt },
    spawnSession: deps.spawnSession ?? null,
  };
  app.get("/api/skill-evals", (req, res) => overview(ctx, req.query, res));
  app.get("/api/skill-evals/runs/:id", (req, res) => oneRun(ctx, req.query, req.params.id, res));
  app.post("/api/skill-evals/runs", (req, res) => startRun(ctx, requestBody(req.body), res));
  app.post("/api/skill-evals/author", (req, res) => startAuthoring(ctx, requestBody(req.body), res));
  app.post("/api/skill-evals/runs/:id/stop", (req, res) => {
    if (stopEvalRun(req.params.id)) res.json({ stopping: true });
    else fail(res, 404, "that evaluation is not running");
  });
}
