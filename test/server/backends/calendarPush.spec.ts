// @vitest-environment node
// Route-level tests for the collection → Google calendar push. The workspace lookup and the
// push engine are stubbed — no collections on disk, no Google grant.
//
// Which failure is an HTTP status and which is a field on a 200 is this route's whole job:
// the view sends `!ok` to the page-level error slot and reads `errors` for the banner beside
// the button, so getting that split wrong shows the reason in the wrong place (or not at
// all). The pure conversion is covered in calendarPushResult.spec.ts.
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { CalendarPushOutcome } from "@mulmoclaude/core/google";

import { mountCalendarPushRoutes, type CalendarPushRouteDeps } from "../../../server/backends/calendarPush.js";
import { PUSH_NOT_DECLARED_ERROR, PUSH_NOT_LINKED_ERROR } from "../../../server/backends/calendarPushResult.js";

const PUSHED: CalendarPushOutcome = {
  kind: "pushed",
  result: { slug: "meetings", created: 2, updated: 1, conflicts: 0, localDeletes: 0, skipped: [], errors: [] },
};

const stubDeps = (over: Partial<CalendarPushRouteDeps> = {}): CalendarPushRouteDeps => ({
  findCollection: vi.fn(async () => ({ slug: "meetings" })),
  push: vi.fn(async () => PUSHED),
  workspaceRoot: () => "/ws",
  ...over,
});

const appWith = (deps: CalendarPushRouteDeps) => {
  const app = express();
  app.use(express.json());
  mountCalendarPushRoutes(app, deps);
  return app;
};

const push = (deps: CalendarPushRouteDeps, slug = "meetings") => request(appWith(deps)).post(`/api/collections/${slug}/calendar-push`).send({});

describe("mountCalendarPushRoutes", () => {
  it("pushes and returns the engine's counts", async () => {
    const deps = stubDeps();
    const res = await push(deps);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pushed: true, created: 2, updated: 1, conflicts: 0, localDeletes: 0, skipped: [], errors: [] });
    expect(deps.push).toHaveBeenCalledWith("meetings", "/ws");
  });

  // Read per request, not captured at mount: the collection host is configured after the
  // routes go up, so a root read at mount time would be the empty string forever.
  it("reads the workspace root per request", async () => {
    let root = "/before";
    const deps = stubDeps({ workspaceRoot: () => root });
    await push(deps);
    root = "/after";
    await push(deps);
    expect(deps.push).toHaveBeenLastCalledWith("meetings", "/after");
  });

  // The only genuine 404: there is no collection to report a push result for.
  it("404s an unknown slug without reaching the engine", async () => {
    const deps = stubDeps({ findCollection: vi.fn(async () => null) });
    const res = await push(deps, "nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("'nope' not found");
    expect(deps.push).not.toHaveBeenCalled();
  });

  // The split that matters: a push that COULD NOT RUN is still a 200, because the view only
  // renders `errors` beside the button. A 4xx here would land in the page-level error slot,
  // away from what was clicked — and `fetchJson` drops the body, so it would arrive as a
  // bare "HTTP 400" with no explanation at all.
  describe("every refusal answers 200 with the reason in errors", () => {
    it.each<[string, CalendarPushOutcome, string]>([
      ["not-linked", { kind: "not-linked" }, PUSH_NOT_LINKED_ERROR],
      // Existence is gated above; "exists but declares no calendar" reaches the engine and
      // comes back here. MulmoClaude 400s this one — see the route for why we do not.
      ["not-a-calendar", { kind: "not-a-calendar" }, PUSH_NOT_DECLARED_ERROR],
      ["read-only", { kind: "read-only", accessRole: "reader" }, "reader"],
      ["failed", { kind: "failed", message: "calendar API unreachable" }, "calendar API unreachable"],
    ])("%s", async (_label, outcome, expected) => {
      const res = await push(stubDeps({ push: vi.fn(async () => outcome) }));
      expect(res.status).toBe(200);
      expect(res.body.created).toBe(0);
      expect(res.body.errors.join(" ")).toContain(expected);
    });
  });

  // The engine catches its own failures into `{kind:"failed"}`, so a throw here means
  // something below it broke. It must not escape as an unhandled rejection.
  it("500s when a dependency throws", async () => {
    const res = await push(
      stubDeps({
        push: vi.fn(async () => {
          throw new Error("workspace unreadable");
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("workspace unreadable");
  });

  it("500s when the collection lookup throws", async () => {
    const res = await push(
      stubDeps({
        findCollection: vi.fn(async () => {
          throw new Error("discovery failed");
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("discovery failed");
  });
});
