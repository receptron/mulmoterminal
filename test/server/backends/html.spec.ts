// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { initArtifactsBackend } from "../../../../server/../../server/backends/artifacts.js";
import { mountHtmlDispatchRoute, mountHtmlPreviewRoute } from "../../../../server/../../server/backends/html.js";

let server: Server;
let base: string;
let ws: string;
const REL = "artifacts/html/2026/06/page.html";

beforeAll(async () => {
  ws = mkdtempSync(path.join(tmpdir(), "mt-html-"));
  mkdirSync(path.join(ws, "artifacts", "html", "2026", "06"), { recursive: true });
  writeFileSync(path.join(ws, REL), "<!doctype html><html><body>ORIGINAL</body></html>");
  initArtifactsBackend({ workspace: ws });

  const app = express();
  app.use(express.json());
  mountHtmlDispatchRoute(app);
  mountHtmlPreviewRoute(app, { workspace: ws });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => server?.close());

const dispatch = (body: unknown) =>
  fetch(`${base}/api/plugin/presentHtml`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("html dispatch route", () => {
  it("loadHtml returns the page bytes", async () => {
    const res = await dispatch({ kind: "loadHtml", path: REL });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { html: string }).html).toContain("ORIGINAL");
  });

  it("saveHtml overwrites the file in place", async () => {
    const res = await dispatch({ kind: "saveHtml", path: REL, html: "<html><body>EDITED</body></html>" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: string }).path).toBe(REL);
    expect(readFileSync(path.join(ws, REL), "utf8")).toContain("EDITED");
  });

  it("rejects a path outside artifacts/html", async () => {
    expect((await dispatch({ kind: "loadHtml", path: "artifacts/secrets.html" })).status).toBe(400);
  });

  it("falls through (no handler → 404) for a tool-call with no kind", async () => {
    // The real server has the generic catch-all after this route; here there's none,
    // so next() lands on Express's 404 — proving the tool-call path isn't intercepted.
    expect((await dispatch({ html: "<p>x</p>", title: "t" })).status).toBe(404);
  });
});

describe("html preview route", () => {
  it("serves the page with the preview CSP + nosniff", async () => {
    const res = await fetch(`${base}/${REL}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    // Response-level sandbox so direct navigation can't run the LLM HTML with the
    // app origin's privileges (not just relying on the embedding iframe).
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toMatch(/script-src 'unsafe-inline'/);
  });

  it("403s a path that escapes artifacts/html", async () => {
    const res = await fetch(`${base}/artifacts/html/${encodeURIComponent("../../etc/passwd")}`);
    expect([403, 404]).toContain(res.status); // blocked either by containment or non-.html
  });

  it("404s a missing file", async () => {
    expect((await fetch(`${base}/artifacts/html/nope.html`)).status).toBe(404);
  });
});
