// How a repository wants its changes reviewed (#3407), declared under `review` in its
// `.mulmoterminal.json`: which agent reviews, how many rounds before a person is asked, and how many
// LGTMs naming the current head make it mergeable (CI passing is always required on top).
import { TERMINAL_AGENTS, type TerminalAgent } from "./sessionAgent.js";
import type { BundledSkillName } from "./bundledSkills.js";

// muse is left out because its replies cannot be read back yet (#3375), so a review loop would wait
// on it forever — the same reason waitForSessionReply refuses a muse session.
export const REVIEWER_AGENTS = TERMINAL_AGENTS.filter((agent): agent is Exclude<TerminalAgent, "muse"> => agent !== "muse");
export type ReviewerAgent = (typeof REVIEWER_AGENTS)[number];

export const MAX_REVIEW_ROUNDS = 50;
export const MAX_REQUIRED_LGTM = 5;
export const MAX_REVIEW_SKILL_CHARS = 100;

// The skill is named inside a one-line message the reviewer is typed, so it is held to a name the
// reviewer can run: a slug, or `plugin:slug` — never a space or a line break that would split it.
const SKILL_NAME_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SKILL_NAME_PARTS = 2;

export const isReviewSkillName = (name: string): boolean => {
  const parts = name.split(":");
  return name.length <= MAX_REVIEW_SKILL_CHARS && parts.length <= MAX_SKILL_NAME_PARTS && parts.every((part) => SKILL_NAME_PART.test(part));
};

export const DEFAULT_REVIEW_SKILL: BundledSkillName = "mulmoterminal-review";

export interface ReviewSettings {
  reviewer: ReviewerAgent;
  maxRounds: number;
  requiredLgtm: number;
  skill: string;
}

/** What an omitted field means. A block that is present but empty asks for exactly these. */
export const REVIEW_DEFAULTS: ReviewSettings = { reviewer: "codex", maxRounds: 10, requiredLgtm: 1, skill: DEFAULT_REVIEW_SKILL };

/** The settings in one line, for the Settings preview. */
export const reviewSummary = ({ reviewer, maxRounds, requiredLgtm, skill }: ReviewSettings): string =>
  `${reviewer} with ${skill}, up to ${maxRounds} rounds, ${requiredLgtm} LGTM on the current head`;
