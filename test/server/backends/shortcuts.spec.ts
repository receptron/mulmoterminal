// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { normalizeShortcuts, mountShortcutsRoutes } from "../../../server/backends/../../server/backends/shortcuts.js";

describe("normalizeShortcuts", () => {
  it("drops malformed entries and dedupes on (kind, slug)", () => {
    const out = normalizeShortcuts([
      { kind: "collection", slug: "a", title: "A", icon: "star" },
      { kind: "bogus", slug: "x", title: "X", icon: "y" }, // bad kind → dropped
      { kind: "feed", slug: "" }, // empty slug → dropped
      { kind: "collection", slug: "a", title: "dupe" }, // dupe (kind,slug) → dropped
      { kind: "feed", slug: "b" }, // defaults title→slug, icon→bookmark
      "not an object",
    ]);
    expect(out).toEqual([
      { kind: "collection", slug: "a", title: "A", icon: "star" },
      { kind: "feed", slug: "b", title: "b", icon: "bookmark" },
    ]);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeShortcuts(undefined)).toEqual([]);
    expect(normalizeShortcuts({ shortcuts: [] })).toEqual([]);
  });
});

describe("/api/shortcuts routes", () => {
  let ws: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-sc-"));
    const app = express();
    app.use(express.json());
    mountShortcutsRoutes(app, { workspace: ws });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterEach(() => {
    server?.close();
    rmSync(ws, { recursive: true, force: true });
  });

  it("GET returns [] when the file is absent", async () => {
    const res = await fetch(`${base}/api/shortcuts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shortcuts: [] });
  });

  it("PUT persists the OBJECT-WRAPPER format and GET round-trips it", async () => {
    const shortcuts = [{ kind: "collection", slug: "watchlist", title: "映画", icon: "movie" }];
    const put = await fetch(`${base}/api/shortcuts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ shortcuts });

    // On-disk: object wrapper { shortcuts: [...] }, NOT a bare array — the contract
    // MulmoClaude shares.
    const onDisk = JSON.parse(readFileSync(path.join(ws, "config", "shortcuts.json"), "utf8"));
    expect(Array.isArray(onDisk)).toBe(false);
    expect(onDisk).toEqual({ shortcuts });

    expect(await (await fetch(`${base}/api/shortcuts`)).json()).toEqual({ shortcuts });
  });

  it("PUT normalises (drops junk, dedupes) before persisting", async () => {
    const res = await fetch(`${base}/api/shortcuts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shortcuts: [
          { kind: "collection", slug: "a" },
          { kind: "nope", slug: "b" },
          { kind: "collection", slug: "a" },
        ],
      }),
    });
    expect(await res.json()).toEqual({ shortcuts: [{ kind: "collection", slug: "a", title: "a", icon: "bookmark" }] });
  });

  it("PUT 400s when the body is not { shortcuts: [...] }", async () => {
    const res = await fetch(`${base}/api/shortcuts`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("handles concurrent PUTs without ENOENT/500 (unique temp files)", async () => {
    const put = (slug: string) =>
      fetch(`${base}/api/shortcuts`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shortcuts: [{ kind: "collection", slug }] }),
      });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => put(`c${i}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    // The file is intact (valid wrapper) — one of the writers won, none half-written.
    const onDisk = JSON.parse(readFileSync(path.join(ws, "config", "shortcuts.json"), "utf8"));
    expect(Array.isArray(onDisk.shortcuts)).toBe(true);
    expect(onDisk.shortcuts).toHaveLength(1);
  });

  it("reads an existing MulmoClaude-written file (wrapper format)", async () => {
    mkdirSync(path.join(ws, "config"), { recursive: true });
    writeFileSync(path.join(ws, "config", "shortcuts.json"), JSON.stringify({ shortcuts: [{ kind: "feed", slug: "news", title: "News", icon: "rss_feed" }] }));
    const res = await fetch(`${base}/api/shortcuts`);
    expect(await res.json()).toEqual({ shortcuts: [{ kind: "feed", slug: "news", title: "News", icon: "rss_feed" }] });
  });
});
