import type { Express } from "express";
import { extractRateLimits, type RateLimits } from "./statusline.js";

// Deps injected from index.ts so the origin guard and the store boundary are testable
// without booting the server (mirrors tmux-routes / gitRemote / open-dir).
export interface RateLimitRouteDeps {
  isAllowedOrigin: (origin?: string) => boolean;
  // The windows are an account-wide budget shared by every session, so the store holds
  // one latest value rather than one per session.
  setRateLimits: (limits: RateLimits) => void;
  getRateLimits: () => RateLimits | null;
}

export function mountRateLimitRoutes(app: Express, deps: RateLimitRouteDeps): void {
  // Written by the statusLine we inject into `claude --settings`, which pipes Claude
  // Code's status payload here on every re-render.
  app.post("/api/rate-limits", (req, res) => {
    if (!deps.isAllowedOrigin(req.headers.origin)) return res.status(403).json({ error: "forbidden origin" });
    const limits = extractRateLimits(req.body);
    // A payload without rate_limits is routine (API-key billing, or before the session's
    // first API response) — keep the last known windows rather than blanking them.
    if (limits) deps.setRateLimits(limits);
    res.json({ ok: true });
  });

  app.get("/api/rate-limits", (_req, res) => {
    res.json(deps.getRateLimits());
  });
}
