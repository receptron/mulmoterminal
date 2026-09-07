// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { normalizeShortcuts, mountShortcutsRoutes } from "../../../server/backends/shortcuts.js";

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

  // #1993: this rebuilds every record, so a field it does not list is DELETED rather than passed
  // through. `color` is MulmoClaude's — it stores it in this shared file and draws it — and leaving
  // it out wiped the colours from every entry each time this app wrote the file.
  it("keeps the colour MulmoClaude stores, whatever the palette says", () => {
    expect(normalizeShortcuts([{ kind: "collection", slug: "a", title: "A", icon: "star", color: "violet" }])).toEqual([
      { kind: "collection", slug: "a", title: "A", icon: "star", color: "violet" },
    ]);
    // Not validated against a palette this app does not have: a check that drifted from theirs
    // would delete a colour they consider valid, which is the bug itself.
    expect(normalizeShortcuts([{ kind: "collection", slug: "a", color: "not-a-palette-name" }])[0].color).toBe("not-a-palette-name");
  });

  // #1996: the file is shared, and BOTH apps rebuild every record they write — so a field only one
  // of them names is deleted by the other. Naming each new one in both apps is a rule someone has
  // to remember; carrying the rest through is not.
  it("carries a field this build has never heard of", () => {
    const stored = { kind: "collection", slug: "a", title: "A", icon: "star", sortHint: 3, badge: { text: "new" } };
    expect(normalizeShortcuts([stored])).toEqual([stored]);
  });

  // ...but a carried field never beats a validated one: the known fields are applied last.
  it("lets the checked value win over what the file held", () => {
    expect(normalizeShortcuts([{ kind: "feed", slug: "b", title: 5, icon: "", extra: "kept" }])).toEqual([
      { kind: "feed", slug: "b", title: "b", icon: "bookmark", extra: "kept" },
    ]);
  });

  // The trap #966 records for the global config: assigning a key named `__proto__` re-parents the
  // object and drops the key from the JSON. Built with fromEntries, it stays ordinary data.
  it("keeps a __proto__ key as data rather than a prototype", () => {
    const [entry] = normalizeShortcuts([JSON.parse('{"kind":"collection","slug":"a","__proto__":{"polluted":true}}')]);
    expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
    expect(Object.hasOwn(entry, "__proto__")).toBe(true);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  // Absent rather than null: `color: undefined` serialises as `null`, a value the other app would
  // then have to know to ignore.
  it("leaves the key out when there is no colour to carry", () => {
    const [entry] = normalizeShortcuts([{ kind: "feed", slug: "b", color: 7 }]);
    expect(entry).toEqual({ kind: "feed", slug: "b", title: "b", icon: "bookmark" });
    expect("color" in entry).toBe(false);
  });
});

describe("/api/shortcuts routes", () => {
  let ws: string;
  let request: ReturnType<typeof appRequest>;

  beforeEach(() => {
    ws = mkdtempSync(path.join(tmpdir(), "mt-sc-"));
    const app = express();
    app.use(express.json());
    mountShortcutsRoutes(app, { workspace: ws });
    request = appRequest(app);
  });

  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("GET returns [] when the file is absent", async () => {
    const res = await request("/api/shortcuts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ shortcuts: [] });
  });

  it("PUT persists the OBJECT-WRAPPER format and GET round-trips it", async () => {
    const shortcuts = [{ kind: "collection", slug: "watchlist", title: "映画", icon: "movie" }];
    const put = await request("/api/shortcuts", {
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

    expect(await (await request("/api/shortcuts")).json()).toEqual({ shortcuts });
  });

  it("PUT normalises (drops junk, dedupes) before persisting", async () => {
    const res = await request("/api/shortcuts", {
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
    const res = await request("/api/shortcuts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });

  it("handles concurrent PUTs without ENOENT/500 (unique temp files)", async () => {
    const put = (slug: string) =>
      request("/api/shortcuts", {
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

  // The same round trip as the colour one below, for a field NEITHER app names today: this is what
  // stops the next `color` from being a bug report (#1996).
  it("keeps an unknown field through the read/write round trip", async () => {
    const file = path.join(ws, "config", "shortcuts.json");
    mkdirSync(path.dirname(file), { recursive: true });
    const stored = [{ kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera", futureField: "from another build" }];
    writeFileSync(file, JSON.stringify({ shortcuts: stored }));

    // The body that goes back UP is the one that came DOWN, not the fixture: a client that dropped
    // the field would otherwise pass this test while losing it in real use (CodeRabbit, PR #1999).
    const served = await (await request("/api/shortcuts")).json();
    expect(served).toEqual({ shortcuts: stored });
    const put = await request("/api/shortcuts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(served),
    });
    expect(put.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8")).shortcuts[0]).toEqual(stored[0]);
  });

  // Carried, NOT merged. A writer that means to REMOVE the field — the other app dropping something
  // it no longer stores — must not have it put back by this one, which is what a merge against the
  // file on write would do.
  it("lets a write remove an unknown field it left out", async () => {
    const file = path.join(ws, "config", "shortcuts.json");
    mkdirSync(path.dirname(file), { recursive: true });
    const kept = { kind: "collection", slug: "lens", title: "Lens", icon: "photo_camera" };
    writeFileSync(file, JSON.stringify({ shortcuts: [{ ...kept, futureField: "from another build" }] }));

    const put = await request("/api/shortcuts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts: [kept] }),
    });
    expect(put.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8")).shortcuts[0]).toEqual(kept);
  });

  // The path that actually broke (#1993): MulmoClaude writes a colour, this app reads the file and
  // writes it back — a pin/unpin here is exactly that — and the colour has to survive the round
  // trip, on the wire AND on disk.
  it("does not strip MulmoClaude's colour when it rewrites the file", async () => {
    const file = path.join(ws, "config", "shortcuts.json");
    mkdirSync(path.dirname(file), { recursive: true });
    const stored = [{ kind: "collection", slug: "lens", title: "カメラのレンズ", icon: "photo_camera", color: "amber" }];
    writeFileSync(file, JSON.stringify({ shortcuts: stored }));

    const served = await (await request("/api/shortcuts")).json();
    expect(served).toEqual({ shortcuts: stored });

    // ...and putting back what was served — what pinning one more thing does — keeps it on disk.
    const put = await request("/api/shortcuts", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts: [...stored, { kind: "feed", slug: "news", title: "News", icon: "rss_feed" }] }),
    });
    expect(put.status).toBe(200);
    expect(JSON.parse(readFileSync(file, "utf8")).shortcuts[0]).toEqual(stored[0]);
  });

  it("reads an existing MulmoClaude-written file (wrapper format)", async () => {
    mkdirSync(path.join(ws, "config"), { recursive: true });
    writeFileSync(path.join(ws, "config", "shortcuts.json"), JSON.stringify({ shortcuts: [{ kind: "feed", slug: "news", title: "News", icon: "rss_feed" }] }));
    const res = await request("/api/shortcuts");
    expect(await res.json()).toEqual({ shortcuts: [{ kind: "feed", slug: "news", title: "News", icon: "rss_feed" }] });
  });
});
