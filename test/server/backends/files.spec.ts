// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { appRequest } from "../../helpers/appRequest.js";
import { mountFilesRoutes } from "../../../server/backends/files.js";
import { makeTempDir } from "../../support/tempDir";
import { canSymlink } from "../../support/canSymlink";
import { initProjectRoots, projectId } from "../../../server/infra/project-root.js";

let request: ReturnType<typeof appRequest>;
// A session project dir OUTSIDE the workspace root (a sibling repo), reachable only via
// the `?cwd=` scope — mirrors an agent whose cwd is a different repo.
let sessionDir: string;
let projectDir: string;

beforeAll(() => {
  const ws = makeTempDir("mt-files-");
  mkdirSync(path.join(ws, "downloads", "images"), { recursive: true });
  // 4-byte PNG signature — enough to assert byte length + Range.
  writeFileSync(path.join(ws, "downloads", "images", "a.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(ws, "secret.txt"), "top secret");
  // #2040: the save name. A non-ASCII name needs `filename*`, a quoted one needs escaping, and a
  // symlink is where "the name asked for" and "the name on disk" come apart.
  writeFileSync(path.join(ws, "downloads", "images", "月次 レポート.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(ws, "downloads", "images", 'weird";name.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // Windows needs Developer Mode or an elevated shell to make one, so the spec that reads it is
  // `runIf(canSymlink)` — a fixture that was never created reads as broken behaviour, not as untested.
  if (canSymlink) symlinkSync(path.join(ws, "downloads", "images", "a.png"), path.join(ws, "downloads", "images", "link.png"));

  sessionDir = makeTempDir("mt-session-");
  mkdirSync(path.join(sessionDir, "assets", "media"), { recursive: true });
  writeFileSync(path.join(sessionDir, "assets", "media", "hero.gif"), Buffer.from([0x47, 0x49, 0x46, 0x38]));

  // A PROJECT dir, reachable only by its opaque id — the route's third scope, beside the
  // workspace root and a live session's cwd.
  projectDir = makeTempDir("mt-files-project-");
  mkdirSync(path.join(projectDir, "data"), { recursive: true });
  writeFileSync(path.join(projectDir, "data", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  // The workspace holds a DIFFERENT file at the same relative path, so "served the workspace's"
  // and "served the project's" are distinguishable rather than both just 200.
  mkdirSync(path.join(ws, "data"), { recursive: true });
  writeFileSync(path.join(ws, "data", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  initProjectRoots({ workspace: ws, knownProjects: () => [{ label: "project", path: projectDir }] });

  const app = express();
  mountFilesRoutes(app, { workspace: ws, sessionCwds: () => [sessionDir] });
  request = appRequest(app);
});

describe("GET /api/files/raw — project scope", () => {
  it("serves the named project's file, not the workspace's file of the same path", async () => {
    const res = await request(`/api/files/raw?path=data/pic.png&project=${projectId(projectDir)}`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4);

    const workspaceCopy = await request("/api/files/raw?path=data/pic.png");
    expect((await workspaceCopy.arrayBuffer()).byteLength).toBe(6);
  });

  // PRESENCE, not shape. Express turns a duplicate or bracketed parameter into an array or an
  // object, and reading those as "absent" would serve a WORKSPACE file to a request that
  // explicitly named a project.
  //
  // `?project[x]=y` is deliberately absent from this list: with express's default query parser
  // that is a key literally named `project[x]`, so the request never names a project at all and
  // the workspace is the right answer. The guard still rejects non-strings, for a host that
  // switches the parser.
  it.each([
    ["an unknown id", "?project=0123456789abcdef"],
    ["duplicate parameters", "?project=a&project=b"],
    ["an empty value", "?project="],
  ])("400s for %s rather than falling back to the workspace", async (_label, query) => {
    const res = await request(`/api/files/raw?path=data/pic.png&${query.slice(1)}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/files/raw", () => {
  it("serves a file with the hardening headers", async () => {
    const res = await request("/api/files/raw?path=downloads/images/a.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("400s when path is missing", async () => {
    expect((await request("/api/files/raw")).status).toBe(400);
  });

  it("403s on path traversal", async () => {
    const res = await request(`/api/files/raw?path=${encodeURIComponent("../../etc/passwd")}`);
    expect(res.status).toBe(403);
  });

  it("403s on an absolute path escaping the root", async () => {
    const res = await request(`/api/files/raw?path=${encodeURIComponent("/etc/passwd")}`);
    expect(res.status).toBe(403);
  });

  it("404s on a missing file", async () => {
    expect((await request("/api/files/raw?path=downloads/images/nope.png")).status).toBe(404);
  });

  it("honours a Range request (206 partial)", async () => {
    const res = await request("/api/files/raw?path=downloads/images/a.png", { headers: { Range: "bytes=0-1" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/4");
    expect((await res.arrayBuffer()).byteLength).toBe(2);
  });

  // Regression (#748): a malformed / multi-range header is IGNORED (full 200), not 416 — a
  // 416 to a media element is a failed seek. Only a well-formed past-the-end range gets 416.
  it.each(["bytes=0-1,3-4", "items=0-1", "bytes=abc-1", "0-1"])("serves the full file (200) for the unsupported range %j", async (range) => {
    const res = await request("/api/files/raw?path=downloads/images/a.png", { headers: { Range: range } });
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("answers 416 for a well-formed but unsatisfiable range", async () => {
    const res = await request("/api/files/raw?path=downloads/images/a.png", { headers: { Range: "bytes=99-100" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */4");
  });
});

// Without this header the browser names a save after the URL's last segment plus an extension
// guessed from the type — `raw.png` for every file, whatever it is called on disk (#2040,
// measured the same way in Chromium and in WebKit).
describe("GET /api/files/raw — the save name", () => {
  it("advertises the file's own name, inline so the tab still renders it", async () => {
    const res = await request("/api/files/raw?path=downloads/images/a.png");
    expect(res.headers.get("content-disposition")).toBe("inline; filename=a.png");
  });

  // `attachment` would turn every image, PDF and text file this route serves into a download.
  it("never says attachment", async () => {
    const res = await request("/api/files/raw?path=downloads/images/a.png");
    expect(res.headers.get("content-disposition")).not.toContain("attachment");
  });

  // RFC 6266: an ASCII fallback for old clients, plus the real name percent-encoded.
  it("carries a non-ASCII name in both forms", async () => {
    const res = await request(`/api/files/raw?path=${encodeURIComponent("downloads/images/月次 レポート.png")}`);
    const header = res.headers.get("content-disposition") ?? "";
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain("%E6%9C%88%E6%AC%A1%20%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88.png");
    expect(header).toMatch(/^inline; filename="[^"]*"; filename\*=UTF-8''/);
  });

  it("escapes a quote rather than ending the header early", async () => {
    const res = await request(`/api/files/raw?path=${encodeURIComponent('downloads/images/weird";name.png')}`);
    expect(res.headers.get("content-disposition")).toBe('inline; filename="weird\\";name.png"');
  });

  // The 206 is what a media save takes, so the header has to be set before the Range branch.
  it("carries the name on a partial response too", async () => {
    const res = await request("/api/files/raw?path=downloads/images/a.png", { headers: { Range: "bytes=0-1" } });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-disposition")).toBe("inline; filename=a.png");
  });

  // `resolveContained` realpaths, so the served path is the TARGET. The user clicked the link,
  // and naming the target would both surprise them and name a file they did not ask about.
  it.runIf(canSymlink)("names the link the user asked for, not the file it resolves to", async () => {
    const res = await request("/api/files/raw?path=downloads/images/link.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("inline; filename=link.png");
  });
});

describe("GET /api/files/raw?cwd= (session-scoped serving)", () => {
  it("serves a relative path inside the session cwd", async () => {
    const url = `/api/files/raw?cwd=${encodeURIComponent(sessionDir)}&path=${encodeURIComponent("assets/media/hero.gif")}`;
    const res = await request(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("serves an absolute path that lies inside the session cwd (as a ~/ expansion would)", async () => {
    const abs = path.join(sessionDir, "assets", "media", "hero.gif");
    const res = await request(`/api/files/raw?cwd=${encodeURIComponent(sessionDir)}&path=${encodeURIComponent(abs)}`);
    expect(res.status).toBe(200);
  });

  it("403s on a path escaping the session cwd", async () => {
    const url = `/api/files/raw?cwd=${encodeURIComponent(sessionDir)}&path=${encodeURIComponent("../mt-files-x/secret.txt")}`;
    expect((await request(url)).status).toBe(403);
  });

  it("403s on a cwd that is not the root or a live session dir (even if it exists)", async () => {
    // tmpdir exists and sessionDir lives under it, but tmpdir itself is not an authorized
    // serving base — query tampering can't repoint serving at an arbitrary absolute dir.
    const url = `/api/files/raw?cwd=${encodeURIComponent(tmpdir())}&path=${encodeURIComponent(path.basename(sessionDir) + "/assets/media/hero.gif")}`;
    expect((await request(url)).status).toBe(403);
  });
});
