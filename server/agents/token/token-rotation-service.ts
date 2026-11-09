// Token rotation's two runtime halves (#2919): a usage meter per configured token, and the choice
// of token for a new session's process, made from those meters' readings.
//
// A token is measured in the DEFAULT home under its own credential — exactly how a cell on it runs —
// by the same meter an account uses, keyed by the token rather than the home they all share.
import { createAccountRateLimits } from "../rate-limit/account-rate-limits.js";
import { assignToken, keptAssignment, OAUTH_TOKEN_ENV, ROTATION_UNSET_ENV, tokenNearLimit, type TokenAssignment } from "./token-assignment.js";
import { readRotationToken } from "./token-secret.js";
import { agentHome } from "../agent-homes.js";
import { getTokenRotation } from "../../config/config-routes.js";
import { DEFAULT_LOGIN_ID, type RotationToken } from "../../../common/tokenRotation.js";
import type { RateLimits } from "../../../common/rateLimits.js";
import type { ProbeStall } from "../probe/probe-stall.js";
import type { LoginRateLimits } from "../rate-limit/rate-limit-routes.js";

const MS_PER_SEC = 1000;
/** How long a limit hit holds a credential out. Only until a probe measures it: the probe's reading
 *  (at its ceiling, with its reset time) then decides, so this need only outlast the next probe. */
export const SPENT_HOLD_SEC = 60 * 60;

/** A rotation token as a meter sees it: a claude login like an account's. */
type MeteredToken = RotationToken & { agent: "claude" };
const meteredToken = (token: RotationToken): MeteredToken => ({ ...token, agent: "claude" });

const rotationTokens = (): MeteredToken[] => {
  const rotation = getTokenRotation();
  return rotation.enabled ? rotation.tokens.map(meteredToken) : [];
};

export interface TokenRotationDeps {
  startHomeProbe: (
    home: string,
    probeReportKey: string,
    onSettled: (stall: ProbeStall) => void,
    unset: readonly string[],
    env: Record<string, string>,
    settingsEnv: Record<string, string>,
  ) => () => void;
  claudeAvailable: () => boolean;
  /** The `/login` credential's last windows, from the default gauge's store. */
  defaultLoginLimits: () => RateLimits | null;
  /** Sessions running on a credential now, by token id — what spreads parallel sessions (#2926). */
  liveSessions: (tokenId: string) => number;
}

export interface TokenRotationRuntime {
  meters: LoginRateLimits;
  assignToken: () => TokenAssignment | null;
  keptAssignment: (tokenId: string | undefined) => TokenAssignment | null;
  /** A session on this credential hit its limit (#2919). */
  markSpent: (tokenId: string) => void;
  /** Whether a new process would start on a credential that is not held out. */
  hasFreeChoice: () => boolean;
  /** Whether a running session on this credential should move at the end of its turn. */
  isNearLimit: (tokenId: string) => boolean;
}

export function createTokenRotation(deps: TokenRotationDeps): TokenRotationRuntime {
  // A secret that cannot be read throws, which the meter counts as a probe that never ran.
  const meters = createAccountRateLimits<MeteredToken>({
    accounts: rotationTokens,
    homeOf: () => agentHome("claude"),
    loginOf: (token) => `claude-token:${token.id}`,
    readCodex: () => null,
    startClaudeProbe: (home, probeReportKey, onSettled, token) => {
      const secret = readRotationToken(token);
      if (!secret) throw new Error(`rotation token "${token.id}" could not be read`);
      // In the probe's 0600 settings file, as a cell's token is, never in the child's environment.
      return deps.startHomeProbe(home, probeReportKey, onSettled, ROTATION_UNSET_ENV, {}, { [OAUTH_TOKEN_ENV]: secret });
    },
    claudeAvailable: deps.claudeAvailable,
  });

  // In memory: a restart forgets a mark, and the probe's reading takes over from there.
  const spentUntil = new Map<string, number>();
  const nowSec = () => Math.floor(Date.now() / MS_PER_SEC);

  // A token whose last probe found it at its usage limit reports no windows at all (the block comes
  // before any response), so the probe's verdict is what holds it out until a later probe answers.
  const failedProbe = (id: string) => meters.readings(Date.now()).find((reading) => reading.id === id && reading.probe === "no-report");
  const atLimitByProbe = (id: string): boolean => failedProbe(id)?.probeStall === "usage-limit";
  const heldUntil = (id: string): number | null => spentUntil.get(id) ?? (atLimitByProbe(id) ? nowSec() + SPENT_HOLD_SEC : null);
  const limitsOf = (tokenId: string): RateLimits | null => {
    if (tokenId === DEFAULT_LOGIN_ID) return deps.defaultLoginLimits();
    const token = getTokenRotation().tokens.find((candidate) => candidate.id === tokenId);
    return token ? meters.lastClaudeLimits(meteredToken(token)) : null;
  };

  const assign = (onlyFree: boolean): TokenAssignment | null =>
    assignToken({
      rotation: getTokenRotation(),
      defaultLoginLimits: deps.defaultLoginLimits,
      tokenLimits: (token) => meters.lastClaudeLimits(meteredToken(token)),
      spentUntil_sec: heldUntil,
      liveSessions: deps.liveSessions,
      probeFailed: (id) => failedProbe(id) !== undefined,
      unusable: (id) => failedProbe(id)?.probeStall === "subscription-disabled",
      readSecret: readRotationToken,
      now_sec: nowSec(),
      onlyFree,
    });

  return {
    meters: { ...meters, readings: (now_ms) => meters.readings(now_ms).map((reading) => ({ ...reading, rotation: true })) },
    assignToken: () => assign(false),
    keptAssignment: (tokenId) => keptAssignment(getTokenRotation(), tokenId, readRotationToken),
    markSpent: (tokenId) => spentUntil.set(tokenId, nowSec() + SPENT_HOLD_SEC),
    hasFreeChoice: () => assign(true) !== null,
    isNearLimit: (tokenId) => tokenNearLimit(getTokenRotation(), tokenId, limitsOf(tokenId), nowSec()),
  };
}
