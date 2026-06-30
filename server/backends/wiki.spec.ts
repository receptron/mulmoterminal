// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mountWikiRoutes } from "./wiki.js";

// A minimal wiki laid out at core's canonical location (wikiDirs):
//   <ws>/data/wiki/index.md       — the index (two bullet [[links]])
//   <ws>/data/wiki/pages/*.md     — the page files (alpha links to beta)
//   <ws>/data/wiki/log.md         — the activity log
// alpha → beta gives one graph edge; both pages are indexed so lint is clean.
let server: Server;
let base: string;

beforeAll(async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mt-wiki-"));
  const wikiDir = path.join(ws, "data", "wiki");
  mkdirSync(path.join(wikiDir, "pages"), { recursive: true });
  writeFileSync(path.join(wikiDir, "index.md"), "# Index\n\n- [[alpha]]\n- [[beta]]\n");
  writeFileSync(path.join(wikiDir, "pages", "alpha.md"), "# Alpha\n\nLinks to [[beta]].\n");
  writeFileSync(path.join(wikiDir, "pages", "beta.md"), "# Beta\n\nNo links.\n");
  writeFileSync(path.join(wikiDir, "log.md"), "log line\n");

  const app = express();
  mountWikiRoutes(app, { workspace: ws });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
});

describe("GET /api/wiki", () => {
  it("returns the index content + parsed entries", async () => {
    const res = await fetch(`${base}/api/wiki`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { content: string; entries: Array<{ slug: string; title: string }> };
    expect(body.content).toContain("[[alpha]]");
    expect(body.entries.map((e) => e.slug)).toEqual(["alpha", "beta"]);
  });
});

describe("GET /api/wiki?slug=", () => {
  it("returns an existing page", async () => {
    const res = await fetch(`${base}/api/wiki?slug=alpha`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exists: boolean; content: string; resolvedTitle: string };
    expect(body.exists).toBe(true);
    expect(body.content).toContain("[[beta]]");
    expect(body.resolvedTitle).toBe("alpha");
  });

  it("404s a missing page", async () => {
    const res = await fetch(`${base}/api/wiki?slug=ghost`);
    expect(res.status).toBe(404);
  });

  it("400s an unsafe slug", async () => {
    expect((await fetch(`${base}/api/wiki?slug=${encodeURIComponent("../../etc/passwd")}`)).status).toBe(400);
  });

  it("400s a repeated (array) slug query rather than 500ing", async () => {
    // `?slug=a&slug=b` parses to a string[], which the typeof guard must reject before
    // it ever reaches readWikiPage.
    expect((await fetch(`${base}/api/wiki?slug=a&slug=b`)).status).toBe(400);
  });
});

describe("GET /api/wiki/graph", () => {
  it("returns nodes + the resolved alpha→beta edge", async () => {
    const res = await fetch(`${base}/api/wiki/graph`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: Array<{ slug: string }>; edges: Array<{ from: string; to: string }> };
    expect(body.nodes.map((n) => n.slug).sort()).toEqual(["alpha", "beta"]);
    expect(body.edges).toEqual([{ from: "alpha", to: "beta" }]);
  });
});

describe("GET /api/wiki/lint", () => {
  it("returns issues + a rendered report (healthy fixture)", async () => {
    const res = await fetch(`${base}/api/wiki/lint`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { issues: string[]; report: string };
    expect(body.issues).toEqual([]);
    expect(typeof body.report).toBe("string");
    expect(body.report.length).toBeGreaterThan(0);
  });
});
