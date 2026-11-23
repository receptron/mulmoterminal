// How many implementers startIssueSession may have running at once, machine-wide (#3413). Each one
// starts a reviewer of its own, so the sessions, the tokens and the CI runs it costs are double this.

export const DEFAULT_MAX_ISSUE_SESSIONS = 2;
export const MIN_MAX_ISSUE_SESSIONS = 1;
// Past this the limit no longer limits anything a machine can run; a typo of `20` reads as the default.
export const MAX_MAX_ISSUE_SESSIONS = 8;

/** A whole number within range; anything else is the default rather than "no limit". */
export function sanitizeMaxIssueSessions(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_MAX_ISSUE_SESSIONS;
  if (value < MIN_MAX_ISSUE_SESSIONS || value > MAX_MAX_ISSUE_SESSIONS) return DEFAULT_MAX_ISSUE_SESSIONS;
  return value;
}
