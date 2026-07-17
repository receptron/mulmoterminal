// @vitest-environment node
// Route-level tests for the Settings modal's Google link. The auth flow, token store,
// and unlink are stubbed — no browser, no loopback listener, no real token.
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

import { mountGoogleRoutes, type GoogleRouteDeps } from "../../../server/backends/google.js";

const stubDeps = (over: Partial<GoogleRouteDeps> = {}) => {
  const deps: GoogleRouteDeps = {
    authFlow: {
      start: vi.fn(async () => ({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?x=1" })),
      status: vi.fn(() => ({ pending: false, lastError: null })),
    },
    unlink: vi.fn(async () => undefined),
    secretPresence: vi.fn(async () => "found" as const),
    loadTokens: vi.fn(async () => ({ refresh_token: "secret-refresh-token" })),
    ...over,
  };
  return deps;
};

const appWith = (deps: GoogleRouteDeps, allowOrigin = true) => {
  const app = express();
  app.use(express.json());
  mountGoogleRoutes(app, { isAllowedOrigin: () => allowOrigin }, deps);
  return app;
};

describe("mountGoogleRoutes", () => {
  let deps: GoogleRouteDeps;
  beforeEach(() => {
    deps = stubDeps();
  });

  describe("GET /api/google/status", () => {
    it("reports linked when a refresh token is stored, without leaking it", async () => {
      const res = await request(appWith(deps)).get("/api/google/status");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ linked: true, pending: false, clientSecret: "found", lastError: null });
      expect(JSON.stringify(res.body)).not.toContain("secret-refresh-token");
    });

    it("reports not-linked when no token is stored", async () => {
      const res = await request(appWith(stubDeps({ loadTokens: vi.fn(async () => null) }))).get("/api/google/status");
      expect(res.body.linked).toBe(false);
    });

    // An access token alone doesn't survive a restart, so it must not read as linked.
    it("reports not-linked when the stored token has no refresh token", async () => {
      const res = await request(appWith(stubDeps({ loadTokens: vi.fn(async () => ({ access_token: "at" })) }))).get("/api/google/status");
      expect(res.body.linked).toBe(false);
    });

    it("surfaces a pending flow and its last error", async () => {
      const authFlow = { start: vi.fn(), status: vi.fn(() => ({ pending: true, lastError: "consent timed out" })) };
      const res = await request(appWith(stubDeps({ authFlow }))).get("/api/google/status");
      expect(res.body.pending).toBe(true);
      expect(res.body.lastError).toBe("consent timed out");
    });

    it("passes a missing client secret through", async () => {
      const res = await request(appWith(stubDeps({ secretPresence: vi.fn(async () => "missing" as const) }))).get("/api/google/status");
      expect(res.body.clientSecret).toBe("missing");
    });

    it("answers 500 when the token store throws", async () => {
      const failing = stubDeps({
        loadTokens: vi.fn(async () => {
          throw new Error("token file unreadable");
        }),
      });
      const res = await request(appWith(failing)).get("/api/google/status");
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/token file unreadable/);
    });
  });

  describe("POST /api/google/authorize", () => {
    it("returns the consent URL", async () => {
      const res = await request(appWith(deps)).post("/api/google/authorize");
      expect(res.status).toBe(200);
      expect(res.body.authUrl).toMatch(/^https:\/\/accounts\.google\.com\//);
    });

    it("answers 500 when the flow cannot start", async () => {
      const authFlow = {
        start: vi.fn(async () => {
          throw new Error("client secret missing");
        }),
        status: vi.fn(() => ({ pending: false, lastError: null })),
      };
      const res = await request(appWith(stubDeps({ authFlow }))).post("/api/google/authorize");
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/client secret missing/);
    });
  });

  describe("POST /api/google/unlink", () => {
    it("unlinks and reports it", async () => {
      const res = await request(appWith(deps)).post("/api/google/unlink");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ linked: false });
      expect(deps.unlink).toHaveBeenCalledTimes(1);
    });

    it("answers 500 when unlink throws", async () => {
      const failing = stubDeps({
        unlink: vi.fn(async () => {
          throw new Error("revoke failed");
        }),
      });
      const res = await request(appWith(failing)).post("/api/google/unlink");
      expect(res.status).toBe(500);
    });
  });

  // Without this guard any site the user visits could drive these routes — /unlink
  // would silently drop the account link (CSRF).
  describe("origin guard", () => {
    it.each([
      ["get", "/api/google/status"],
      ["post", "/api/google/authorize"],
      ["post", "/api/google/unlink"],
    ])("rejects a foreign origin on %s %s", async (method, url) => {
      const app = appWith(deps, false);
      const res = method === "get" ? await request(app).get(url) : await request(app).post(url);
      expect(res.status).toBe(403);
    });

    it("does not act on a rejected request", async () => {
      await request(appWith(deps, false)).post("/api/google/unlink");
      expect(deps.unlink).not.toHaveBeenCalled();
      expect(deps.authFlow.start).not.toHaveBeenCalled();
    });
  });
});
