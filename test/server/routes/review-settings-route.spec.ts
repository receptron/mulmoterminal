// @vitest-environment node
// reviewSettings (#3407): a repository's declared review settings, from the clone its work starts in.
import { describe, it, expect, vi } from "vitest";
import type { Express } from "express";
import { mountReviewSettingsRoute, reviewSettingsAnswer } from "../../../server/routes/review-settings-route.js";
import { REVIEW_DEFAULTS, type ReviewSettings } from "../../../common/reviewSettings.js";
import { defaultCloneOf, type RepoDirs } from "../../../common/repoDirs.js";

type Handler = (req: { body: unknown }, res: { json: (body: { message: string; jsonData?: unknown }) => void }) => Promise<unknown>;

function route(cloneOf: (repo: string) => Promise<string | null>, reviewOf: (dir: string) => ReviewSettings | null): Handler {
  const map: Record<string, Handler> = {};
  const app = { post: (path: string, handler: Handler) => (map[path] = handler) } as unknown as Express;
  mountReviewSettingsRoute(app, { cloneOf, reviewOf });
  const handler = map["/api/plugin/reviewSettings"];
  if (!handler) throw new Error("route not mounted");
  return handler;
}

async function ask(handler: Handler, body: unknown): Promise<{ message: string; jsonData?: unknown }> {
  let answer: { message: string; jsonData?: unknown } = { message: "" };
  await handler({ body }, { json: (body) => (answer = body) });
  return answer;
}

describe("the reviewSettings route", () => {
  it("answers the settings of the repository's clone", async () => {
    const reviewOf = vi.fn(() => ({ ...REVIEW_DEFAULTS, reviewer: "claude" as const }));
    const answer = await ask(
      route(async () => "/work/repo", reviewOf),
      { repo: "owner/repo" },
    );
    expect(reviewOf).toHaveBeenCalledWith("/work/repo");
    expect(answer.jsonData).toEqual({ repo: "owner/repo", dir: "/work/repo", ...REVIEW_DEFAULTS, reviewer: "claude" });
    expect(answer.message).toMatch(/reviewer claude/);
  });

  it.each([[undefined], [{}], [{ repo: 42 }], [{ repo: "not a repo" }], [{ repo: "" }]])("refuses a request without a repository: %j", async (body) => {
    const cloneOf = vi.fn(async () => "/x");
    expect(
      (
        await ask(
          route(cloneOf, () => null),
          body,
        )
      ).message,
    ).toMatch(/`repo` must be a repository/);
    expect(cloneOf).not.toHaveBeenCalled();
  });

  it("says when the machine has no clone of it, without reading any config", async () => {
    const reviewOf = vi.fn(() => REVIEW_DEFAULTS);
    expect(
      (
        await ask(
          route(async () => null, reviewOf),
          { repo: "owner/repo" },
        )
      ).message,
    ).toMatch(/No local clone/);
    expect(reviewOf).not.toHaveBeenCalled();
  });
});

describe("reviewSettingsAnswer", () => {
  it("says a repository declares nothing, with no settings attached", () => {
    const answer = reviewSettingsAnswer("owner/repo", "/work/repo", null);
    expect(answer.message).toMatch(/declares no review settings/);
    expect(answer.jsonData).toBeUndefined();
  });
});

describe("defaultCloneOf", () => {
  const candidate = (path: string) => ({ path, label: path, orderPriority: null });
  const entries: RepoDirs[] = [
    { repo: "owner/recorded", dirs: [candidate("/a"), candidate("/b")], primary: "/b" },
    { repo: "owner/plain", dirs: [candidate("/c"), candidate("/d")], primary: null },
    { repo: "owner/empty", dirs: [], primary: null },
  ];

  it("takes the recorded choice", () => {
    expect(defaultCloneOf(entries, "owner/recorded")).toBe("/b");
  });

  it("otherwise takes the first candidate", () => {
    expect(defaultCloneOf(entries, "owner/plain")).toBe("/c");
  });

  it("matches the repository however its case is written", () => {
    expect(defaultCloneOf(entries, "Owner/Plain")).toBe("/c");
  });

  it("is null for a repository with no clone, or none at all", () => {
    expect(defaultCloneOf(entries, "owner/empty")).toBeNull();
    expect(defaultCloneOf(entries, "owner/unknown")).toBeNull();
    expect(defaultCloneOf([], "owner/plain")).toBeNull();
  });
});
