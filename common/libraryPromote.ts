// Promoting a conversation from the Library (#3334): what it can become, and the turn that asks the
// bundled skill to make it. Both sides decide from these — the reader lists the targets, the server
// refuses any other and writes the turn — so they are named once, here.
import type { BundledSkillName } from "./bundledSkills.js";
import { isProjectSlug } from "./libraryMemory.js";

/** What a conversation can be promoted to: a memory, a `CLAUDE.md` rule, a plan under `plans/`, an
 *  issue, or a skill. */
export const PROMOTE_TARGETS = ["memory", "rule", "plan", "issue", "skill"] as const;

export type PromoteTarget = (typeof PROMOTE_TARGETS)[number];

export const isPromoteTarget = (value: unknown): value is PromoteTarget => PROMOTE_TARGETS.some((target) => target === value);

/** The skill that reads the conversation and writes what it is promoted to, once the person approves. */
export const PROMOTE_SKILL: BundledSkillName = "mulmoterminal-library";

/** A Claude session id, a UUID: the only shape the transcript routes the skill reads it through take
 *  (a subagent's file name is not one, so a subagent's conversation is not promoted). Only such an id
 *  is put into the turn, so nothing the browser sent can become words the agent reads. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first turn of the session that promotes `sessionId`, or null for an id that is not one. */
export function promoteTurn(target: PromoteTarget, sessionId: string): string | null {
  return SESSION_ID.test(sessionId) ? `/${PROMOTE_SKILL} promote ${target} ${sessionId}` : null;
}

/** The first turn of the session that proposes how to tidy one project's memory, or null for a
 *  folder name that is not one Claude Code makes. */
export function tidyTurn(slug: string): string | null {
  return isProjectSlug(slug) ? `/${PROMOTE_SKILL} tidy ${slug}` : null;
}
