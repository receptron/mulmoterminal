import { describe, it, expect, vi } from "vitest";
import type { Express } from "express";
import { mountRateLimitRoutes, type RateLimitRouteDeps } from "./rate-limit-routes.js";
import type { RateLimits } from "./statusline.js";

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}
function makeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

type Handler = (req: { headers: { origin?: string }; body?: unknown }, res: FakeRes) => unknown;

// Mount with the given deps and hand back the handlers by method — no HTTP server needed
// (mirrors tmux-routes.spec's capture pattern).
function mountAndCapture(deps: RateLimitRouteDeps): { post: Handler; get: Handler } {
  const posts = new Map<string, Handler>();
  const gets = new Map<string, Handler>();
  const app = {
    post: (p: string, h: Handler) => posts.set(p, h),
    get: (p: string, h: Handler) => gets.set(p, h),
  } as unknown as Express;
  mountRateLimitRoutes(app, deps);
  const post = posts.get("/api/rate-limits");
  const get = gets.get("/api/rate-limits");
  if (!post || !get) throw new Error("routes not mounted");
  return { post, get };
}

const limits: RateLimits = { fiveHour: { usedPercentage: 23.5, resetsAt_sec: 1738425600 }, sevenDay: null };
const payload = { rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } } };

function makeDeps(overrides: Partial<RateLimitRouteDeps> = {}): RateLimitRouteDeps {
  return {
    isAllowedOrigin: () => true,
    setRateLimits: vi.fn(),
    getRateLimits: () => null,
    ...overrides,
  };
}

describe("POST /api/rate-limits", () => {
  it("stores the windows extracted from a statusLine payload", () => {
    const setRateLimits = vi.fn();
    const { post } = mountAndCapture(makeDeps({ setRateLimits }));
    const res = makeRes();
    post({ headers: {}, body: payload }, res);
    expect(setRateLimits).toHaveBeenCalledWith(limits);
    expect(res.payload).toEqual({ ok: true });
  });

  it("keeps the last known windows when a payload carries none", () => {
    const setRateLimits = vi.fn();
    const { post } = mountAndCapture(makeDeps({ setRateLimits }));
    const res = makeRes();
    post({ headers: {}, body: { model: { display_name: "Opus" } } }, res);
    expect(setRateLimits).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("rejects a cross-origin write without storing (CSRF guard)", () => {
    const setRateLimits = vi.fn();
    const { post } = mountAndCapture(makeDeps({ isAllowedOrigin: () => false, setRateLimits }));
    const res = makeRes();
    post({ headers: { origin: "https://evil.example" }, body: payload }, res);
    expect(res.statusCode).toBe(403);
    expect(setRateLimits).not.toHaveBeenCalled();
  });
});

describe("GET /api/rate-limits", () => {
  it("serves the stored windows", () => {
    const { get } = mountAndCapture(makeDeps({ getRateLimits: () => limits }));
    const res = makeRes();
    get({ headers: {} }, res);
    expect(res.payload).toEqual(limits);
  });

  it("serves null when nothing has been reported yet", () => {
    const { get } = mountAndCapture(makeDeps());
    const res = makeRes();
    get({ headers: {} }, res);
    expect(res.payload).toBeNull();
  });
});
