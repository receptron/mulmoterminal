// The Skills viewer's side of a skill evaluation (#3438): what is set up for a skill and its runs,
// starting and stopping a run, and starting the cell that drafts the test tasks with the user.
import type { SkillSource } from "../../common/skillCatalog";
import { skillEvalOverviewSchema, type SkillEvalOverview } from "../../common/skillEval";
import { jsonBody } from "../jsonBody";
import { fetchWithTimeout, SLOW_COMMAND_TIMEOUT_MS } from "../utils/fetchWithTimeout";

/** The request fields that name a skill, as the catalog routes take them. */
export function skillFields(source: SkillSource, slug: string): Record<string, string> {
  if (source.scope === "plugin") return { slug, plugin: source.plugin };
  return source.scope === "project" ? { slug, dir: source.dir } : { slug };
}

const post = (body: Record<string, unknown>): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Null when it could not be read. */
export async function loadSkillEval(source: SkillSource, slug: string): Promise<SkillEvalOverview | null> {
  try {
    const res = await fetchWithTimeout(`/api/skill-evals?${new URLSearchParams(skillFields(source, slug)).toString()}`);
    if (!res.ok) return null;
    const parsed = skillEvalOverviewSchema.safeParse(await jsonBody(res));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type SkillEvalStartResult = { kind: "started"; id: string } | { kind: "busy" } | { kind: "failed"; error: string };

export async function startSkillEvalRun(source: SkillSource, slug: string): Promise<SkillEvalStartResult> {
  try {
    const res = await fetchWithTimeout("/api/skill-evals/runs", post(skillFields(source, slug)));
    if (res.status === 409) return { kind: "busy" };
    const answer = await jsonBody(res);
    if (res.ok && typeof answer.id === "string") return { kind: "started", id: answer.id };
    return { kind: "failed", error: typeof answer.error === "string" ? answer.error : "" };
  } catch {
    return { kind: "failed", error: "" };
  }
}

export async function stopSkillEvalRun(runId: string): Promise<boolean> {
  try {
    return (await fetchWithTimeout(`/api/skill-evals/runs/${encodeURIComponent(runId)}/stop`, post({}))).ok;
  } catch {
    return false;
  }
}

/** The id of the Claude cell that drafts the test tasks, or null when it could not be started. */
export async function startSkillEvalAuthoring(source: SkillSource, slug: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout("/api/skill-evals/author", post(skillFields(source, slug)), SLOW_COMMAND_TIMEOUT_MS);
    const answer = await jsonBody(res);
    return res.ok && typeof answer.chatId === "string" ? answer.chatId : null;
  } catch {
    return null;
  }
}
