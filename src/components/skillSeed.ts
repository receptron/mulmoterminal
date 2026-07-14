// The text typed into the running session to invoke a skill picked from the header
// Skill menu. Claude has a `/<slug>` command; codex has none (skills auto-load by
// description), so it's named in natural language instead — the client-side mirror
// of server/codex-skills.ts codexifySkillSeed.
export function skillSeed(slug: string, codex: boolean): string {
  return codex ? `Use the "${slug}" skill.` : `/${slug}`;
}
