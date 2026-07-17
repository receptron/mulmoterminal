// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { mintViewToken, verifyViewToken, clampCapabilities, requireViewToken, VIEW_TOKEN_TTL_MS, type ViewCapability } from "../../../server/backends/viewToken.js";
import type { Request, Response, NextFunction } from "express";

describe("viewToken mint/verify", () => {
  it("round-trips a minted token", () => {
    const { token, exp } = mintViewToken("watchlist", ["read"], 1000);
    expect(exp).toBe(1000 + VIEW_TOKEN_TTL_MS);
    const payload = verifyViewToken(token, 2000);
    expect(payload).toEqual({ slug: "watchlist", caps: ["read"], exp: 1000 + VIEW_TOKEN_TTL_MS });
  });

  it("rejects a tampered payload", () => {
    const { token } = mintViewToken("watchlist", ["read"], 1000);
    const [payloadB64, sig] = token.split(".");
    // Re-encode a payload claiming a different slug, keep the original signature.
    const forged = Buffer.from(JSON.stringify({ slug: "secrets", caps: ["read", "write"], exp: 1000 + VIEW_TOKEN_TTL_MS }), "utf8").toString("base64url");
    expect(verifyViewToken(`${forged}.${sig}`, 2000)).toBeNull();
    // Sanity: the untouched token still verifies.
    expect(verifyViewToken(`${payloadB64}.${sig}`, 2000)).not.toBeNull();
  });

  it("rejects a bad signature", () => {
    const { token } = mintViewToken("watchlist", ["read"], 1000);
    const [payloadB64] = token.split(".");
    expect(verifyViewToken(`${payloadB64}.deadbeef`, 2000)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token, exp } = mintViewToken("watchlist", ["read"], 1000);
    expect(verifyViewToken(token, exp)).toBeNull(); // exactly at exp → expired
    expect(verifyViewToken(token, exp + 1)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyViewToken("")).toBeNull();
    expect(verifyViewToken("nodot")).toBeNull();
    expect(verifyViewToken(".onlysig")).toBeNull();
  });
});

describe("clampCapabilities", () => {
  const cases: Array<[ViewCapability[] | undefined, ViewCapability[] | undefined, ViewCapability[]]> = [
    [["read", "write"], ["read"], ["read"]], // requested narrows the declared set
    [["read"], ["read", "write"], ["read"]], // declared caps the grant (no write escalation)
    [undefined, undefined, ["read"]], // least-privilege default
    [["read", "write"], undefined, ["read", "write"]], // undefined requested ⇒ full declared set
    [[], ["read"], ["read"]], // empty declared ⇒ default ["read"]
  ];
  it.each(cases)("clamp(%j, %j) → %j", (declared, requested, expected) => {
    expect(clampCapabilities(declared, requested)).toEqual(expected);
  });
});

interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(b: unknown): MockRes;
}
function mockRes(): MockRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

function runGuard(action: ViewCapability, headers: Record<string, string>, slug: string) {
  const res = mockRes();
  const next = vi.fn();
  requireViewToken(action)({ headers, params: { slug } } as unknown as Request, res as unknown as Response, next as NextFunction);
  return { res, next };
}

describe("requireViewToken middleware", () => {
  it("401s with no Authorization header", () => {
    const { res, next } = runGuard("read", {}, "watchlist");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() for a valid token with the right slug + capability", () => {
    const { token } = mintViewToken("watchlist", ["read"]);
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "watchlist");
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("401s when the token's slug differs from the route", () => {
    const { token } = mintViewToken("watchlist", ["read"]);
    const { res, next } = runGuard("read", { authorization: `Bearer ${token}` }, "other");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when the required capability is missing", () => {
    const { token } = mintViewToken("watchlist", ["read"]);
    const { res, next } = runGuard("write", { authorization: `Bearer ${token}` }, "watchlist");
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
