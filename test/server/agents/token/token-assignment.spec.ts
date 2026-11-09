// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  assignToken,
  countLiveSessions,
  keptAssignment,
  OAUTH_TOKEN_ENV,
  ROTATION_UNSET_ENV,
  tokenNearLimit,
  type TokenAssignmentDeps,
} from "../../../../server/agents/token/token-assignment";
import { DEFAULT_LOGIN_ID, type RotationToken, type TokenRotation } from "../../../../common/tokenRotation";
import type { RateLimits } from "../../../../common/rateLimits";

const NOW = 1_800_000_000;
const DAY = 86_400;
const HOUR_SEC = 3600;
const A: RotationToken = { id: "a", label: "A", keychain: "k-a" };
const B: RotationToken = { id: "b", label: "B", file: "/t/b" };
const used = (percent: number, resetIn_sec = 3 * DAY): RateLimits => ({
  fiveHour: null,
  sevenDay: { usedPercentage: percent, resetsAt_sec: NOW + resetIn_sec },
});

const deps = (rotation: Partial<TokenRotation>, over: Partial<TokenAssignmentDeps> = {}): TokenAssignmentDeps => ({
  rotation: { enabled: true, includeDefaultLogin: true, tokens: [A, B], ...rotation },
  defaultLoginLimits: () => used(90),
  tokenLimits: (token) => (token.id === "a" ? used(50) : used(10)),
  readSecret: (token) => `secret-${token.id}`,
  now_sec: NOW,
  ...over,
});

describe("assignToken (#2919)", () => {
  it("is null while rotation is off, whatever the tokens", () => {
    expect(assignToken(deps({ enabled: false }))).toBeNull();
  });

  it("hands the chosen token as CLAUDE_CODE_OAUTH_TOKEN and unsets what would outrank it", () => {
    expect(assignToken(deps({}))).toEqual({ tokenId: "b", env: { [OAUTH_TOKEN_ENV]: "secret-b" }, unset: ROTATION_UNSET_ENV });
  });

  it("chooses the /login credential with no env of its own", () => {
    const assignment = assignToken(deps({}, { defaultLoginLimits: () => used(0) }));
    expect(assignment).toEqual({ tokenId: DEFAULT_LOGIN_ID, env: {}, unset: ROTATION_UNSET_ENV });
  });

  it("leaves the /login credential out when told to", () => {
    expect(assignToken(deps({ includeDefaultLogin: false }, { defaultLoginLimits: () => used(0) }))?.tokenId).toBe("b");
  });

  it("falls to the next candidate when the chosen token cannot be read", () => {
    const assignment = assignToken(deps({}, { readSecret: (token) => (token.id === "b" ? null : `secret-${token.id}`) }));
    expect(assignment?.tokenId).toBe("a");
  });

  it("is null when no token can be read and the /login credential is left out", () => {
    expect(assignToken(deps({ includeDefaultLogin: false }, { readSecret: () => null }))).toBeNull();
  });

  it("with only the /login credential, chooses it", () => {
    expect(assignToken(deps({ tokens: [] }))?.tokenId).toBe(DEFAULT_LOGIN_ID);
  });

  it("is null with nothing to choose from", () => {
    expect(assignToken(deps({ tokens: [], includeDefaultLogin: false }))).toBeNull();
  });

  it("passes spent marks through to the choice", () => {
    expect(assignToken(deps({}, { spentUntil_sec: (id) => (id === "b" ? NOW + DAY : null) }))?.tokenId).toBe("a");
  });

  it("never reads the secret of a token it did not choose", () => {
    const read: string[] = [];
    assignToken(deps({}, { readSecret: (token) => (read.push(token.id), `s-${token.id}`) }));
    expect(read).toEqual(["b"]);
  });
});

describe("keptAssignment (#2919)", () => {
  const rotation: TokenRotation = { enabled: true, includeDefaultLogin: true, tokens: [A, B] };
  const read = (token: RotationToken) => `secret-${token.id}`;

  it("hands back the recorded token, not a fresh choice", () => {
    expect(keptAssignment(rotation, "a", read)).toEqual({ tokenId: "a", env: { [OAUTH_TOKEN_ENV]: "secret-a" }, unset: ROTATION_UNSET_ENV });
  });

  it("hands back the /login credential with no env", () => {
    expect(keptAssignment(rotation, DEFAULT_LOGIN_ID, read)).toEqual({ tokenId: DEFAULT_LOGIN_ID, env: {}, unset: ROTATION_UNSET_ENV });
  });

  it("is null for a process rotation did not start", () => {
    expect(keptAssignment(rotation, undefined, read)).toBeNull();
  });

  it("is null for a token that left the config or cannot be read", () => {
    expect(keptAssignment(rotation, "gone", read)).toBeNull();
    expect(keptAssignment(rotation, "a", () => null)).toBeNull();
  });

  it("keeps the running process's token even after rotation was switched off", () => {
    expect(keptAssignment({ ...rotation, enabled: false }, "b", read)?.tokenId).toBe("b");
  });
});

describe("assignToken with onlyFree (#2919)", () => {
  it("refuses to fall back to a held-out candidate", () => {
    const allSpent = deps({}, { spentUntil_sec: () => NOW + DAY, onlyFree: true });
    expect(assignToken(allSpent)).toBeNull();
  });

  it("still picks a free one", () => {
    const oneFree = deps({}, { spentUntil_sec: (id) => (id === "b" ? NOW + DAY : null), onlyFree: true });
    expect(assignToken(oneFree)?.tokenId).toBe("a");
  });

  it("without onlyFree, falls back to the one free soonest as before", () => {
    expect(assignToken(deps({}, { spentUntil_sec: () => NOW + DAY }))).not.toBeNull();
  });
});

describe("tokens whose probe failed (#3291)", () => {
  it("never chooses a token that cannot run Claude Code, even when it would win", () => {
    expect(assignToken(deps({ includeDefaultLogin: false }, { unusable: (id) => id === "b" }))?.tokenId).toBe("a");
  });

  it("does not fall back to an unusable token when every other one is held out", () => {
    const rest = deps({ includeDefaultLogin: false }, { unusable: (id) => id === "b", spentUntil_sec: (id) => (id === "a" ? NOW + DAY : null) });
    expect(assignToken(rest)?.tokenId).toBe("a");
    expect(assignToken(deps({ includeDefaultLogin: false, tokens: [B] }, { unusable: () => true }))).toBeNull();
  });

  it("never reads the secret of an unusable token", () => {
    const read: string[] = [];
    assignToken(deps({ includeDefaultLogin: false }, { unusable: (id) => id === "b", readSecret: (token) => (read.push(token.id), `s-${token.id}`) }));
    expect(read).toEqual(["a"]);
  });

  it("passes a failed probe through, so its stale reading stops winning", () => {
    // b would win on its reading (used(10) beats used(50)).
    const failedB = deps({ includeDefaultLogin: false }, { probeFailed: (id) => id === "b" });
    expect(assignToken(failedB)?.tokenId).toBe("a");
  });

  it("applies both to the /login credential too", () => {
    const onlyDefault = deps({ tokens: [] }, { defaultLoginLimits: () => used(10) });
    expect(assignToken(onlyDefault)?.tokenId).toBe(DEFAULT_LOGIN_ID);
    expect(assignToken({ ...onlyDefault, unusable: (id) => id === DEFAULT_LOGIN_ID })).toBeNull();
  });
});

describe("live sessions (#2926)", () => {
  it("counts the running sessions recorded on a token", () => {
    const tokenOf = (id: string) => ({ s1: "a", s2: "a", s3: "b" })[id];
    expect(countLiveSessions(["s1", "s2", "s3", "s4"], tokenOf, "a")).toBe(2);
    expect(countLiveSessions(["s1", "s2", "s3", "s4"], tokenOf, "b")).toBe(1);
    expect(countLiveSessions([], tokenOf, "a")).toBe(0);
  });

  it("moves the next session off a busy token", () => {
    // b would win on pace (used(10) beats used(50)), but has three sessions on it already.
    const busy = assignToken(
      deps(
        {},
        { defaultLoginLimits: () => used(100), tokenLimits: (token) => (token.id === "a" ? used(50) : used(10)), liveSessions: (id) => (id === "b" ? 3 : 0) },
      ),
    );
    expect(busy?.tokenId).toBe("a");
  });
});

describe("a token's weekly reserve (#3064)", () => {
  it("carries the config's reserve to the choice, so a token at its line is passed over", () => {
    const reservedB: RotationToken = { ...B, reserveWeeklyPercent: 5 };
    const limitsOf = (token: RotationToken) => (token.id === "a" ? used(50) : used(95, HOUR_SEC));
    expect(assignToken(deps({ includeDefaultLogin: false }, { tokenLimits: limitsOf }))?.tokenId).toBe("b");
    expect(assignToken(deps({ includeDefaultLogin: false, tokens: [A, reservedB] }, { tokenLimits: limitsOf }))?.tokenId).toBe("a");
  });

  it("starts nothing on rotation when the only token is down to its reserve", () => {
    const reservedA: RotationToken = { ...A, reserveWeeklyPercent: 5 };
    expect(assignToken(deps({ includeDefaultLogin: false, tokens: [reservedA] }, { tokenLimits: () => used(96) }))).toBeNull();
  });
});

describe("tokenNearLimit (#3064)", () => {
  const rotation: TokenRotation = { enabled: true, includeDefaultLogin: true, tokens: [A, { ...B, reserveWeeklyPercent: 5 }] };

  it("moves a session on a reserved token at its own line, and not below it", () => {
    expect(tokenNearLimit(rotation, "b", used(95), NOW)).toBe(true);
    expect(tokenNearLimit(rotation, "b", used(94.9), NOW)).toBe(false);
  });

  it("keeps the usual line for a token without a reserve, the /login credential and a token gone from the config", () => {
    expect(tokenNearLimit(rotation, "a", used(95), NOW)).toBe(false);
    expect(tokenNearLimit(rotation, DEFAULT_LOGIN_ID, used(95), NOW)).toBe(false);
    expect(tokenNearLimit(rotation, "gone", used(95), NOW)).toBe(false);
    expect(tokenNearLimit(rotation, "a", used(98), NOW)).toBe(true);
  });
});
