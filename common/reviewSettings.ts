// How a repository wants its changes reviewed (#3407), declared under `review` in its
// `.mulmoterminal.json`: which agent reviews, how many rounds before a person is asked, and how many
// LGTMs naming the current head make it mergeable (CI passing is always required on top).
import { TERMINAL_AGENTS, type TerminalAgent } from "./sessionAgent.js";

// muse is left out because its replies cannot be read back yet (#3375), so a review loop would wait
// on it forever — the same reason waitForSessionReply refuses a muse session.
export const REVIEWER_AGENTS = TERMINAL_AGENTS.filter((agent): agent is Exclude<TerminalAgent, "muse"> => agent !== "muse");
export type ReviewerAgent = (typeof REVIEWER_AGENTS)[number];

export const MAX_REVIEW_ROUNDS = 50;
export const MAX_REQUIRED_LGTM = 5;

export interface ReviewSettings {
  reviewer: ReviewerAgent;
  maxRounds: number;
  requiredLgtm: number;
}

/** What an omitted field means. A block that is present but empty asks for exactly these. */
export const REVIEW_DEFAULTS: ReviewSettings = { reviewer: "codex", maxRounds: 10, requiredLgtm: 1 };

/** The settings in one line, for the Settings preview. */
export const reviewSummary = ({ reviewer, maxRounds, requiredLgtm }: ReviewSettings): string =>
  `${reviewer}, up to ${maxRounds} rounds, ${requiredLgtm} LGTM on the current head`;
