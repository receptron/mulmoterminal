// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { mountFilesRoutes, isProbablyTextSample } from "./files.js";

let server: Server;
let base: string;

beforeAll(async () => {
  const ws = mkdtempSync(path.join(tmpdir(), "mt-files-"));
  mkdirSync(path.join(ws, "downloads", "images"), { recursive: true });
  // 4-byte PNG signature — enough to assert byte length + Range.
  writeFileSync(path.join(ws, "downloads", "images", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(ws, "secret.txt"), "top secret");

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
});

describe("isProbablyTextSample", () => {
  it("treats NUL-free bytes as text", () => {
    expect(isProbablyTextSample(Buffer.from("const x = 1;\nexport {};", "utf8"))).toBe(true);
    expect(isProbablyTextSample(Buffer.from(""))).toBe(true);
  });
  it("treats a NUL byte as binary", () => {
    expect(isProbablyTextSample(Buffer.from([0x89, 0x50, 0x00, 0x47]))).toBe(false);
  });
});
