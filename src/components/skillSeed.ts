// The text typed into the running session to invoke a skill picked from the header
// Skill menu. Claude has a `/<slug>` command; the others have none (their skills auto-load by
// description), so the skill is named in natural language instead — the client-side mirror
// of server/agents/codex-skills.ts codexifySkillSeed.
//
// Claude is the exception rather than the rule here, so the test is for claude and everything
// else takes the sentence: an agent added later gets a seed that works before anyone teaches it
// slash commands, rather than a `/slug` its parser drops on the floor.
import type { TerminalAgent } from "../../common/sessionAgent";

export function skillSeed(slug: string, agent: TerminalAgent): string {
  return agent === "claude" ? `/${slug}` : `Use the "${slug}" skill.`;
}
