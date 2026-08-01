// @vitest-environment node
// presentDocument / presentHtml's `path`, resolved against the CALLING SESSION's directory
// rather than CLAUDE_CWD (backends/sessionRelativePath.ts). The decision is entirely in
// `sessionRelativePath`, so it is pinned directly; the route wiring around it is a two-line
// middleware asserted through an express app at the bottom.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { sessionRelativePath, mountSessionRelativePathRewrite, SESSION_HEADER } from "../../../server/backends/sessionRelativePath.js";
import { ptys } from "../../../server/session/registry.js";

let dir: string;
const tempDirs: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mt-sessrel-"));
  tempDirs.push(dir);
});

afterEach(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seed(rel: string): string {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, "# hi\n");
  return abs;
}

describe("sessionRelativePath", () => {
  it("resolves a relative path against the session cwd when the file is there", () => {
    const abs = seed("docs/report.html");
    expect(sessionRelativePath("docs/report.html", dir)).toBe(abs);
  });

  it("leaves the value alone when nothing exists there (workspace resolution still applies)", () => {
    expect(sessionRelativePath("docs/missing.html", dir)).toBeNull();
  });

  it("leaves a directory alone even when the name matches", () => {
    mkdirSync(path.join(dir, "report.html"));
    expect(sessionRelativePath("report.html", dir)).toBeNull();
  });

  it("never rewrites an absolute path", () => {
    const abs = seed("docs/report.html");
    expect(sessionRelativePath(abs, dir)).toBeNull();
  });

  it("never rewrites a Windows-shaped value on POSIX", () => {
    expect(sessionRelativePath("C:/proj/x.md", dir)).toBeNull();
    expect(sessionRelativePath("\\\\server\\share\\x.md", dir)).toBeNull();
  });

  it("does nothing without a session cwd, or for an unusable value", () => {
    seed("docs/report.html");
    expect(sessionRelativePath("docs/report.html", null)).toBeNull();
    expect(sessionRelativePath("", dir)).toBeNull();
    expect(sessionRelativePath("doc\0s.md", dir)).toBeNull();
    expect(sessionRelativePath(42, dir)).toBeNull();
  });

  it("allows a value that climbs out of the session cwd, since the `path` form is uncontained", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "mt-sessrel-out-"));
    tempDirs.push(outside);
    writeFileSync(path.join(outside, "x.md"), "x");
    const climbed = path.join("..", path.basename(outside), "x.md");
    expect(sessionRelativePath(climbed, dir)).toBe(path.join(outside, "x.md"));
  });
});

describe("the /api/plugin rewrite", () => {
  const sessionId = "11111111-2222-3333-4444-555555555555";

  function app() {
    const instance = express();
    instance.use(express.json());
    mountSessionRelativePathRewrite(instance);
    instance.post("/api/plugin/:tool", (req, res) => res.json({ path: (req.body as { path?: unknown }).path }));
    return instance;
  }

  afterEach(() => ptys.delete(sessionId));

  it("rewrites presentHtml's path to the session cwd's copy", async () => {
    const abs = seed("docs/report.html");
    ptys.set(sessionId, { cwd: dir } as never);
    const res = await request(app()).post("/api/plugin/presentHtml").set(SESSION_HEADER, sessionId).send({ path: "docs/report.html" }).expect(200);
    expect(res.body.path).toBe(abs);
  });

  it("leaves presentMulmoScript's filePath-shaped `path` untouched — it is not a path tool", async () => {
    seed("docs/report.html");
    ptys.set(sessionId, { cwd: dir } as never);
    const res = await request(app()).post("/api/plugin/presentMulmoScript").set(SESSION_HEADER, sessionId).send({ path: "docs/report.html" }).expect(200);
    expect(res.body.path).toBe("docs/report.html");
  });

  it("passes through a request with no session header (the View's own dispatch)", async () => {
    seed("docs/report.md");
    ptys.set(sessionId, { cwd: dir } as never);
    const res = await request(app()).post("/api/plugin/presentDocument").send({ path: "docs/report.md" }).expect(200);
    expect(res.body.path).toBe("docs/report.md");
  });

  it("ignores a malformed session id rather than trusting it", async () => {
    seed("docs/report.md");
    const res = await request(app()).post("/api/plugin/presentDocument").set(SESSION_HEADER, "../../etc").send({ path: "docs/report.md" }).expect(200);
    expect(res.body.path).toBe("docs/report.md");
  });
});
