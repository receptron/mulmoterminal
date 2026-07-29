// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { initArtifactsBackend } from "../../../server/backends/artifacts.js";
import { mountHtmlDispatchRoute, mountHtmlFileRoute, mountHtmlPreviewRoute } from "../../../server/backends/html.js";
import { initOpenPathBackend, resetOpenPathBackend, resolveHtmlRequest } from "../../../server/backends/openPath.js";

let server: Server;
let base: string;
let ws: string;
const REL = "artifacts/html/2026/06/page.html";
// A page OUTSIDE artifacts/html — what presentHtml's `path` form is for.
const REPO_REL = "docs/report.html";

beforeAll(async () => {
  ws = mkdtempSync(path.join(tmpdir(), "mt-html-"));
  mkdirSync(path.join(ws, "artifacts", "html", "2026", "06"), { recursive: true });
  writeFileSync(path.join(ws, REL), "<!doctype html><html><body>ORIGINAL</body></html>");
  mkdirSync(path.join(ws, "docs", ".hidden"), { recursive: true });
  writeFileSync(path.join(ws, REPO_REL), "<!doctype html><html><body>REPO</body></html>");
  writeFileSync(path.join(ws, "docs", ".hidden", "secret.html"), "<html>SECRET</html>");
  initArtifactsBackend({ workspace: ws });
  resetOpenPathBackend();
  initOpenPathBackend({ workspace: ws });

  const app = express();
  app.use(express.json());
  mountHtmlDispatchRoute(app);
  mountHtmlPreviewRoute(app, { workspace: ws });
  mountHtmlFileRoute(app);
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

  it("loads a page outside artifacts/html through byPath", async () => {
    const res = await dispatch({ kind: "loadHtml", path: REPO_REL });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { html: string }).html).toContain("REPO");
  });

  it("saveHtml overwrites a page outside artifacts/html in place", async () => {
    const res = await dispatch({ kind: "saveHtml", path: REPO_REL, html: "<html><body>REPO EDITED</body></html>" });
    expect(res.status).toBe(200);
    expect(readFileSync(path.join(ws, REPO_REL), "utf8")).toContain("REPO EDITED");
  });

  it("rejects a path that does not exist (400, not a 500)", async () => {
    expect((await dispatch({ kind: "loadHtml", path: "artifacts/secrets.html" })).status).toBe(400);
  });

  it("refuses to CREATE a page the editor was pointed at", async () => {
    const res = await dispatch({ kind: "saveHtml", path: "docs/brand-new.html", html: "<html></html>" });
    expect(res.status).toBe(400);
    expect(existsSync(path.join(ws, "docs", "brand-new.html"))).toBe(false);
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

// These assert the WIRING — that the route hands the raw request path to core's
// parser and serves what it resolves. The scheme's own rules (scopes, traversal,
// dotfiles, %2F smuggling) are core's, tested in MulmoClaude.
describe("htmlfile route", () => {
  it("serves a workspace page with the same CSP as the artifacts preview", async () => {
    const res = await fetch(`${base}/htmlfile/ws/docs/report.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("REPO");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).toContain("connect-src 'none'");
  });

  // The separator after `abs` is JOINED IN, never left to the split. A POSIX absolute path
  // begins with the separator, so splitting it yields a leading "" that supplies that slash
  // for free — on Windows there is no such element and the drive letter fuses onto the scope
  // (`/htmlfile/absC%3A/…`), which parses as the scope "absC:" and 404s. Dropping the empty
  // element and joining explicitly gives `abs/C%3A/…` there, which is the drive-letter form
  // core's parser is written for and which nothing else in CI exercises (#1079).
  const htmlFileAbsUrl = (abs: string) => ["abs", ...abs.split(path.sep).filter(Boolean).map(encodeURIComponent)].join("/");

  it("serves a page by absolute path", async () => {
    const res = await fetch(`${base}/htmlfile/${htmlFileAbsUrl(path.join(ws, REPO_REL))}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("REPO");
  });

  it("404s an unknown scope", async () => {
    expect((await fetch(`${base}/htmlfile/nope/docs/report.html`)).status).toBe(404);
  });

  it("refuses a traversal segment at the resolver", async () => {
    // Not reachable over HTTP — every URL parser between here and the route collapses
    // `..` (and `%2e%2e`) before the request is sent — so assert the resolver the
    // route delegates to. The smuggled form that DOES survive the wire is below.
    expect(await resolveHtmlRequest("ws/docs/../report.html")).toBeNull();
  });

  it("404s a %2F-smuggled separator (the parser decodes per segment)", async () => {
    expect((await fetch(`${base}/htmlfile/ws/docs%2F..%2Fdocs/report.html`)).status).toBe(404);
  });

  it("404s a dotfile segment — the tool's path gate refuses these too", async () => {
    expect((await fetch(`${base}/htmlfile/ws/docs/.hidden/secret.html`)).status).toBe(404);
  });

  it("404s a non-HTML path", async () => {
    expect((await fetch(`${base}/htmlfile/ws/docs/report.txt`)).status).toBe(404);
  });

  it("404s a directory named like a page", async () => {
    mkdirSync(path.join(ws, "docs", "folder.html"), { recursive: true });
    expect((await fetch(`${base}/htmlfile/ws/docs/folder.html`)).status).toBe(404);
  });
});
