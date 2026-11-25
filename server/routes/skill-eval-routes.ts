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
import {
  isBaselineFor,
  ladderAttempts,
  improveAttempts,
  maxImproveCostUsd,
  maxLadderCostUsd,
  maxRunCostUsd,
  plannedAttempts,
  SKILL_EVAL_AUTHOR_SKILL,
  type SkillEvalOverview,
  type SkillEvalRun,
  type SkillEvalRunMode,
  type SkillEvalSet,
} from "../../common/skillEval.js";
import { isEditableSkill } from "../backends/skills/skillEdit.js";
import type { LibraryCaller } from "../backends/library/library-service.js";
import { sharedCaller } from "./library-routes.js";
import { adoptCandidate } from "../backends/skillEval/evalAdopt.js";
import { readEvalMarks } from "../backends/skillEval/evalMarks.js";
import type { SpawnIssueSession } from "../session/spawn/issue-session-spawn.js";
import { commandRunner, type AttemptDeps } from "../backends/skillEval/evalAttempt.js";
import { runClaude } from "../backends/skillEval/runClaude.js";
import { listRuns, newestRunWhere, readEvalSet, readRun, skillEvalFolder, textHash } from "../backends/skillEval/evalStore.js";
import { activeRunId, effectiveStatus, startEvalRun, stopEvalRun } from "../backends/skillEval/evalRunner.js";
import { docSource } from "./skill-source-query.js";
import { requestBody } from "./requestBody.js";
import { homedir, tmpdir } from "node:os";
import { evalDirWriteRules } from "../backends/skillEval/evalWriteRules.js";

export const SKILL_EVALS_ROOT = path.join(MULMOTERMINAL_HOME, "skill-evals");

export interface SkillEvalRouteDeps {
  root?: string;
  attempt?: Partial<AttemptDeps>;
  cwds?: () => Promise<string[]>;
  /** Starts the Claude cell that drafts a set with the user; without it, that answers 503. */
  spawnSession?: SpawnIssueSession;
  /** The Library, for the conversations that ran a skill (#3470). Override the worker, for tests. */
  library?: LibraryCaller;
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
  /** The name claude runs it by. */
  id: string;
  slug: string;
  file: string;
  source: SkillDocSource;
  /** Its evaluation folder. */
  evalDir: string;
}

async function resolveSkill(root: string, query: Record<string, unknown>, cwds: () => Promise<string[]>): Promise<ResolvedSkill | null> {
  const slug = typeof query.slug === "string" ? query.slug : "";
  const source = docSource(query);
  const file = await skillDocFile({ source, slug, cwds: await cwds() });
  if (file === null || !(await isFile(file))) return null;
  const id = skillIdOf(source, slug);
  return { id, slug, file, source, evalDir: skillEvalFolder(root, id, source.scope === "project" ? source.dir : null) };
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
  library: LibraryCaller;
}

// Plan mode, as for the Library's promote: the skill shows its draft and writes nothing until the user
// approves, and Claude Code holds that rather than the skill's own wording.
const AUTHOR_PERMISSION_MODE = "plan";

/** The first turn of the drafting cell: the skill's name, where its SKILL.md is, the folder to save in, and the
 *  transcripts of conversations that ran it, whose requests the tasks can be drafted from (#3470). */
export function authorTurn(skill: ResolvedSkill, conversations: readonly string[]): string {
  const turn = `/${SKILL_EVAL_AUTHOR_SKILL} skill ${JSON.stringify(skill.id)}, SKILL.md at ${JSON.stringify(skill.file)}, save in ${JSON.stringify(skill.evalDir)}`;
  return conversations.length === 0 ? turn : `${turn}, past conversations ${JSON.stringify(conversations)}`;
}

/** The conversations that ran the skill, newest first; none when the Library cannot say, which only loses the hint. */
async function conversationsOf(ctx: Context, skill: ResolvedSkill): Promise<string[]> {
  const cwd = skill.source.scope === "project" ? skill.source.dir : null;
  const paths = await ctx.library("skillConversations", [skill.id, cwd]).catch(() => null);
  return Array.isArray(paths) ? paths.filter((entry): entry is string => typeof entry === "string") : [];
}

async function startAuthoring(ctx: Context, body: Record<string, unknown>, res: Response): Promise<void> {
  if (ctx.spawnSession === null) return fail(res, 503, "sessions cannot be started here");
  const skill = await resolveSkill(ctx.root, body, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  // A folder's skill is drafted in that folder; the user's and a plugin's anywhere, so the home.
  const cwd = skill.source.scope === "project" ? skill.source.dir : homedir();
  try {
    const turn = authorTurn(skill, await conversationsOf(ctx, skill));
    const options = { claudePermissionMode: AUTHOR_PERMISSION_MODE, claudeAllowedTools: evalDirWriteRules(skill.evalDir) };
    const spawned = await ctx.spawnSession("claude", cwd, turn, true, null, options);
    res.json({ chatId: spawned.sessionId, agent: spawned.agent });
  } catch (err) {
    fail(res, 500, err instanceof Error ? err.message : "the session could not be started");
  }
}

const currentSkillHash = async (skill: ResolvedSkill): Promise<string | null> => {
  const skillText = await readFile(skill.file, "utf8").catch(() => null);
  return skillText === null ? null : textHash(skillText);
};

/** The run the next improvement of `skill` would be written from, if it has one. */
async function baselineOf(skill: ResolvedSkill, setHash: string, skillHash: string | null): Promise<SkillEvalRun | null> {
  if (skillHash === null) return null;
  return newestRunWhere(skill.evalDir, (run) => isBaselineFor(run, setHash, skillHash));
}

const estimateOf = (set: SkillEvalSet): NonNullable<SkillEvalOverview["estimate"]> => ({
  ...{ attempts: plannedAttempts(set), maxCostUsd: maxRunCostUsd(set), improveAttempts: improveAttempts(set), maxImproveCostUsd: maxImproveCostUsd(set) },
  ...{ ladderAttempts: ladderAttempts(set), maxLadderCostUsd: maxLadderCostUsd(set) },
});

async function overview(ctx: Context, query: Record<string, unknown>, res: Response): Promise<void> {
  const skill = await resolveSkill(ctx.root, query, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const read = await readEvalSet(skill.evalDir, skill.id);
  const set = read.kind === "ok" ? read.set : null;
  const skillHash = await currentSkillHash(skill);
  res.json({
    ...{ skill: skill.id, dir: skill.evalDir, set, setHash: read.kind === "ok" ? read.hash : null, setError: read.kind === "invalid" ? read.error : null },
    estimate: set === null ? null : estimateOf(set),
    editable: isEditableSkill(skill.source, skill.slug),
    ...{ skillHash, baseline: read.kind === "ok" ? await baselineOf(skill, read.hash, skillHash) : null },
    ...{ runs: (await listRuns(skill.evalDir)).map(runView), activeRunId: activeRunId(skill.evalDir) },
  });
}

async function oneRun(ctx: Context, query: Record<string, unknown>, runId: string, res: Response): Promise<void> {
  const skill = await resolveSkill(ctx.root, query, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const run = await readRun(skill.evalDir, runId);
  if (run === null) return fail(res, 404, "run not found");
  res.json(runView(run));
}

async function startRun(ctx: Context, body: Record<string, unknown>, res: Response, mode: SkillEvalRunMode): Promise<void> {
  const improve = mode === "improve";
  const skill = await resolveSkill(ctx.root, body, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const read = await readEvalSet(skill.evalDir, skill.id);
  if (read.kind === "absent") return fail(res, 404, "no evaluation is set up for this skill");
  if (read.kind === "invalid") return fail(res, 400, read.error);
  if (mode === "ladder" && ladderAttempts(read.set) === 0) return fail(res, 400, "there is no task the skill should help with");
  const improveFrom = improve ? await baselineOf(skill, read.hash, await currentSkillHash(skill)) : null;
  if (improve && improveFrom === null) return fail(res, 400, "measure the skill as it is now, with these tasks, first");
  const skillText = await readFile(skill.file, "utf8");
  const skillDir = path.dirname(skill.file);
  const start = {
    evalDir: skill.evalDir,
    set: read.set,
    setHash: read.hash,
    skillDir,
    skillSlug: skill.slug,
    skillText,
    skillHash: textHash(skillText),
    improveFrom,
    ladder: mode === "ladder",
  };
  const started = await startEvalRun(start, ctx.attemptDeps);
  if (started === null) return fail(res, 409, "another evaluation is running");
  res.status(202).json({ id: started.id });
}

async function adopt(ctx: Context, body: Record<string, unknown>, res: Response): Promise<void> {
  const skill = await resolveSkill(ctx.root, body, ctx.cwds);
  if (skill === null) return fail(res, 404, SKILL_NOT_FOUND);
  const run = typeof body.runId === "string" ? await readRun(skill.evalDir, body.runId) : null;
  if (run === null) return fail(res, 404, "run not found");
  const read = await readEvalSet(skill.evalDir, skill.id);
  if (read.kind !== "ok" || read.hash !== run.setHash) return fail(res, 400, "the tasks changed since this improvement was measured");
  const adopted = await adoptCandidate(skill.evalDir, runView(run), { source: skill.source, slug: skill.slug, cwds: await ctx.cwds() }, ctx.attemptDeps.now());
  if (adopted.kind === "changed") return fail(res, 409, "the skill changed since it was measured");
  if (adopted.kind === "refused") return fail(res, 400, adopted.error);
  res.json({ backup: adopted.backup });
}

export function mountSkillEvalRoutes(app: Express, deps: SkillEvalRouteDeps = {}): void {
  const ctx: Context = {
    root: deps.root ?? SKILL_EVALS_ROOT,
    cwds: deps.cwds ?? rememberedSessionCwds,
    attemptDeps: { claudeBin: claudeAdapter.bin(), runClaude, runCommand: commandRunner, tmpRoot: tmpdir(), now: Date.now, ...deps.attempt },
    spawnSession: deps.spawnSession ?? null,
    library: deps.library ?? sharedCaller,
  };
  app.get("/api/skill-evals", (req, res) => overview(ctx, req.query, res));
  app.get("/api/skill-evals/marks", async (_req, res) => {
    res.json({ marks: await readEvalMarks(ctx.root, { cwds: await ctx.cwds() }) });
  });
  app.get("/api/skill-evals/runs/:id", (req, res) => oneRun(ctx, req.query, req.params.id, res));
  app.post("/api/skill-evals/runs", (req, res) => startRun(ctx, requestBody(req.body), res, "measure"));
  app.post("/api/skill-evals/improve", (req, res) => startRun(ctx, requestBody(req.body), res, "improve"));
  app.post("/api/skill-evals/ladder", (req, res) => startRun(ctx, requestBody(req.body), res, "ladder"));
  app.post("/api/skill-evals/adopt", (req, res) => adopt(ctx, requestBody(req.body), res));
  app.post("/api/skill-evals/author", (req, res) => startAuthoring(ctx, requestBody(req.body), res));
  app.post("/api/skill-evals/runs/:id/stop", (req, res) => {
    if (stopEvalRun(req.params.id)) res.json({ stopping: true });
    else fail(res, 404, "that evaluation is not running");
  });
}
