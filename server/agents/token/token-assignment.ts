// Assigning a credential to a new session's process (#2919): the config's candidates, ranked by
// token-choice.ts, and the chosen token's secret turned into the variables the spawn carries.
//
// Pure: the config, the readings, the secret reader and the clock are injected.
import type { RateLimits } from "../../../common/rateLimits.js";
import { DEFAULT_LOGIN_ID, type RotationToken, type TokenRotation } from "../../../common/tokenRotation.js";
import { blockedUntil, chooseToken, nearLimit, type TokenCandidate } from "./token-choice.js";

/** Anything that would outrank the chosen credential (an API key, a provider's token) or stand in
 *  for it (an inherited token) is removed from the session's environment. */
export const ROTATION_UNSET_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"] as const;
export const OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

export interface TokenAssignment {
  /** A token id, or DEFAULT_LOGIN_ID. */
  tokenId: string;
  /** Goes in the settings file's env block — which is a 0600 file, never argv. Empty for the
   *  `/login` credential, which Claude Code reads from its own store. */
  env: Record<string, string>;
  unset: readonly string[];
}

export interface TokenAssignmentDeps {
  rotation: TokenRotation;
  defaultLoginLimits: () => RateLimits | null;
  tokenLimits: (token: RotationToken) => RateLimits | null;
  /** Spent marks from limit hits, by token id (DEFAULT_LOGIN_ID included). */
  spentUntil_sec?: (tokenId: string) => number | null;
  /** Sessions running on each credential now, by token id (DEFAULT_LOGIN_ID included). */
  liveSessions?: (tokenId: string) => number;
  /** Whether the credential's latest probe got no answer, by token id (#3291). */
  probeFailed?: (tokenId: string) => boolean;
  /** Whether the credential cannot run Claude Code at all now — its subscription access is
   *  disabled — by token id. Such a one is no candidate, not even as a last resort (#3291). */
  unusable?: (tokenId: string) => boolean;
  readSecret: (token: RotationToken) => string | null;
  now_sec: number;
  /** Refuse a candidate that is held out, rather than falling back to the one free soonest — for
   *  deciding whether moving a session off a spent token would land anywhere better. */
  onlyFree?: boolean;
}

const candidatesOf = (deps: TokenAssignmentDeps): TokenCandidate[] => {
  const spent = (id: string) => deps.spentUntil_sec?.(id) ?? null;
  const live = (id: string) => deps.liveSessions?.(id) ?? 0;
  const failed = (id: string) => deps.probeFailed?.(id) ?? false;
  const tokens = deps.rotation.tokens.map((token) => ({
    id: token.id,
    limits: deps.tokenLimits(token),
    spentUntil_sec: spent(token.id),
    liveSessions: live(token.id),
    reserveWeeklyPercent: token.reserveWeeklyPercent,
    probeFailed: failed(token.id),
  }));
  const defaultLogin = (): TokenCandidate => ({
    id: DEFAULT_LOGIN_ID,
    limits: deps.defaultLoginLimits(),
    spentUntil_sec: spent(DEFAULT_LOGIN_ID),
    liveSessions: live(DEFAULT_LOGIN_ID),
    probeFailed: failed(DEFAULT_LOGIN_ID),
  });
  const all = deps.rotation.includeDefaultLogin ? [defaultLogin(), ...tokens] : tokens;
  return all.filter((candidate) => !deps.unusable?.(candidate.id));
};

const assignmentOf = (tokenId: string, secret: string | null): TokenAssignment | null => {
  if (tokenId === DEFAULT_LOGIN_ID) return { tokenId, env: {}, unset: ROTATION_UNSET_ENV };
  return secret ? { tokenId, env: { [OAUTH_TOKEN_ENV]: secret }, unset: ROTATION_UNSET_ENV } : null;
};

/**
 * The credential a process ALREADY runs on, for a reattach: its settings file is rewritten on every
 * connection, and must keep saying what the running process was started with rather than whatever
 * would be chosen now. Null when it was not started by rotation, or its token is gone or unreadable.
 */
export function keptAssignment(
  rotation: TokenRotation,
  tokenId: string | undefined,
  readSecret: (token: RotationToken) => string | null,
): TokenAssignment | null {
  if (tokenId === undefined) return null;
  if (tokenId === DEFAULT_LOGIN_ID) return assignmentOf(tokenId, null);
  const token = rotation.tokens.find((candidate) => candidate.id === tokenId);
  return token ? assignmentOf(tokenId, readSecret(token)) : null;
}

/**
 * The credential a new process should run on, or null when rotation has nothing to say — it is
 * off, or no candidate could be used. A token whose secret cannot be read is dropped and the
 * choice made again, so one missing keychain item does not stop every spawn.
 */
export function assignToken(deps: TokenAssignmentDeps): TokenAssignment | null {
  if (!deps.rotation.enabled) return null;
  const pickFrom = (candidates: TokenCandidate[]): TokenAssignment | null => {
    const id = chooseToken(candidates, deps.now_sec);
    if (id === null) return null;
    const chosen = candidates.find((candidate) => candidate.id === id);
    if (deps.onlyFree && chosen && blockedUntil(chosen, deps.now_sec) !== null) return null;
    const token = deps.rotation.tokens.find((candidate) => candidate.id === id);
    const assignment = assignmentOf(id, token ? deps.readSecret(token) : null);
    return assignment ?? pickFrom(candidates.filter((candidate) => candidate.id !== id));
  };
  return pickFrom(candidatesOf(deps));
}

/** How many of the running claude sessions are on `tokenId`, by each one's recorded token. A session
 *  rotation did not start has no record and counts toward none. */
export function countLiveSessions(liveSessionIds: Iterable<string>, tokenOf: (sessionId: string) => string | undefined, tokenId: string): number {
  return [...liveSessionIds].filter((sessionId) => tokenOf(sessionId) === tokenId).length;
}

/** Whether a running session on `tokenId` should move at the end of its turn, at that token's own
 *  weekly reserve line (#3064). The `/login` credential and a token gone from the config have none. */
export function tokenNearLimit(rotation: TokenRotation, tokenId: string, limits: RateLimits | null, now_sec: number): boolean {
  const reserve = rotation.tokens.find((token) => token.id === tokenId)?.reserveWeeklyPercent;
  return nearLimit(limits, now_sec, reserve);
}
