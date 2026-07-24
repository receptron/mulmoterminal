// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mountFilesRoutes } from "../../../server/backends/files.js";

let server: Server;
let base: string;
// A session project dir OUTSIDE the workspace root (a sibling repo), reachable only via
// the `?cwd=` scope — mirrors an agent whose cwd is a different repo.
let sessionDir: string;

beforeAll(async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mt-files-"));
  mkdirSync(path.join(ws, "downloads", "images"), { recursive: true });
  // 4-byte PNG signature — enough to assert byte length + Range.
  writeFileSync(path.join(ws, "downloads", "images", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(ws, "secret.txt"), "top secret");

  sessionDir = mkdtempSync(path.join(tmpdir(), "mt-session-"));
  mkdirSync(path.join(sessionDir, "assets", "media"), { recursive: true });
  writeFileSync(path.join(sessionDir, "assets", "media", "hero.gif"), Buffer.from([0x47, 0x49, 0x46, 0x38]));

  const app = express();
  mountFilesRoutes(app, { workspace: ws });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server?.close();
});

describe("GET /api/files/raw", () => {
  it("serves a file with the hardening headers", async () => {
    const res = await fetch(`${base}/api/files/raw?path=downloads/images/a.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("400s when path is missing", async () => {
    expect((await fetch(`${base}/api/files/raw`)).status).toBe(400);
  });

  it("403s on path traversal", async () => {
    const res = await fetch(`${base}/api/files/raw?path=${encodeURIComponent("../../etc/passwd")}`);
    expect(res.status).toBe(403);
  });

  it("403s on an absolute path escaping the root", async () => {
    const res = await fetch(`${base}/api/files/raw?path=${encodeURIComponent("/etc/passwd")}`);
    expect(res.status).toBe(403);
  });

  it("404s on a missing file", async () => {
    expect((await fetch(`${base}/api/files/raw?path=downloads/images/nope.png`)).status).toBe(404);
  });

  it("honours a Range request (206 partial)", async () => {
    const res = await fetch(`${base}/api/files/raw?path=downloads/images/a.png`, { headers: { Range: "bytes=0-1" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/4");
    expect((await res.arrayBuffer()).byteLength).toBe(2);
  });

  // Regression (#748): a malformed / multi-range header is IGNORED (full 200), not 416 — a
  // 416 to a media element is a failed seek. Only a well-formed past-the-end range gets 416.
  it.each(["bytes=0-1,3-4", "items=0-1", "bytes=abc-1", "0-1"])("serves the full file (200) for the unsupported range %j", async (range) => {
    const res = await fetch(`${base}/api/files/raw?path=downloads/images/a.png`, { headers: { Range: range } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("answers 416 for a well-formed but unsatisfiable range", async () => {
    const res = await fetch(`${base}/api/files/raw?path=downloads/images/a.png`, { headers: { Range: "bytes=99-100" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */4");
  });
});

describe("GET /api/files/raw?cwd= (session-scoped serving)", () => {
  it("serves a relative path inside the session cwd", async () => {
    const url = `${base}/api/files/raw?cwd=${encodeURIComponent(sessionDir)}&path=${encodeURIComponent("assets/media/hero.gif")}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("serves an absolute path that lies inside the session cwd (as a ~/ expansion would)", async () => {
    const abs = path.join(sessionDir, "assets", "media", "hero.gif");
    const res = await fetch(`${base}/api/files/raw?cwd=${encodeURIComponent(sessionDir)}&path=${encodeURIComponent(abs)}`);
    expect(res.status).toBe(200);
  });

  it("403s on a path escaping the session cwd", async () => {
    const url = `${base}/api/files/raw?cwd=${encodeURIComponent(sessionDir)}&path=${encodeURIComponent("../mt-files-x/secret.txt")}`;
    expect((await fetch(url)).status).toBe(403);
  });

  it("falls back to the workspace root when cwd is not an existing absolute dir", async () => {
    const url = `${base}/api/files/raw?cwd=${encodeURIComponent("not/absolute")}&path=downloads/images/a.png`;
    expect((await fetch(url)).status).toBe(200);
  });
});
