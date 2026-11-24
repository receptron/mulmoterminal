// @vitest-environment node
// The server's copy of the grid layout (#3427): what one grid writes, a grid that lost its own reads.
import { describe, it, expect, afterAll } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { jsonPost, routeCall } from "../../helpers/routeCall";
import { mountGridLayoutRoutes } from "../../../server/routes/grid-layout-routes.js";
import { GRID_LAYOUT_MAX_BYTES } from "../../../server/config/grid-layout.js";

const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-grid-layout-")));
afterAll(() => {
  chmodSync(dir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

const LAYOUT = { cells: [{ uid: 0, session: "11111111-1111-4111-8111-111111111111", cwd: "/repo" }], page: 0 };

const serve = (over: { allowed?: boolean; attached?: string[] } = {}) => {
  const file = path.join(mkdtempSync(path.join(dir, "case-")), "grid-layout.json");
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  mountGridLayoutRoutes(app, { file, isAllowedOrigin: () => over.allowed ?? true, attachedSessionIds: () => over.attached ?? [] });
  return { call: routeCall(app), file };
};
const CROSS_SITE = { origin: "https://evil.example" };

describe("GET/POST /api/grid-layout", () => {
  it("has no layout before any grid wrote one, and says which sessions a terminal is showing", async () => {
    const { call } = serve({ attached: ["a", "b"] });
    expect((await call("/api/grid-layout")).body).toEqual({ layout: null, attached: ["a", "b"] });
  });

  it("hands back what a grid wrote", async () => {
    const { call } = serve();
    expect((await call("/api/grid-layout", jsonPost({ layout: LAYOUT }))).status).toBe(200);
    expect((await call("/api/grid-layout")).body.layout).toEqual(LAYOUT);
  });

  it.each([[{}], [{ layout: null }], [{ layout: [1, 2] }], [{ layout: "x" }]])("refuses %j and keeps what it had", async (body) => {
    const { call } = serve();
    await call("/api/grid-layout", jsonPost({ layout: LAYOUT }));
    expect((await call("/api/grid-layout", jsonPost(body))).status).toBe(400);
    expect((await call("/api/grid-layout")).body.layout).toEqual(LAYOUT);
  });

  it("refuses a layout past the cap", async () => {
    const { call } = serve();
    const huge = { cells: [], pad: "x".repeat(GRID_LAYOUT_MAX_BYTES) };
    expect((await call("/api/grid-layout", jsonPost({ layout: huge }))).status).toBe(413);
  });

  // A full disk: the write fails, and the copy already there is the one worth keeping.
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("answers 500 when it cannot write, leaving the old copy", async () => {
    const { call, file } = serve();
    await call("/api/grid-layout", jsonPost({ layout: LAYOUT }));
    chmodSync(path.dirname(file), 0o555);
    try {
      expect((await call("/api/grid-layout", jsonPost({ layout: { cells: [] } }))).status).toBe(500);
    } finally {
      chmodSync(path.dirname(file), 0o755);
    }
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(LAYOUT);
  });

  it.each(["{ nope", "[1]", "null"])("reads a copy that is not an object (%s) as none", async (text) => {
    const { call, file } = serve();
    writeFileSync(file, text);
    expect((await call("/api/grid-layout")).body.layout).toBeNull();
  });

  // A GET is a safe method and judged like its neighbours' (routes/same-origin-guard.ts): what keeps the
  // copy private is that another site cannot read the reply.
  it("refuses a write from another site", async () => {
    const { call } = serve({ allowed: false });
    expect((await call("/api/grid-layout", jsonPost({ layout: LAYOUT }, CROSS_SITE))).status).toBe(403);
    expect((await call("/api/grid-layout")).body.layout).toBeNull();
  });
});
