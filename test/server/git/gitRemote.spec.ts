import { describe, it, expect } from "vitest";
import type { Express } from "express";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseGithubWebUrl, resolveGithubUrl, mountGitRemoteRoute } from "../../../server/git/gitRemote";

const REPO = "https://github.com/owner/repo";

describe("parseGithubWebUrl", () => {
  it("maps scp-like SSH remotes", () => {
    expect(parseGithubWebUrl("git@github.com:owner/repo.git")).toBe(REPO);
    expect(parseGithubWebUrl("git@github.com:owner/repo")).toBe(REPO);
  });

  it("maps SSH URL remotes, including a port", () => {
    expect(parseGithubWebUrl("ssh://git@github.com/owner/repo.git")).toBe(REPO);
    expect(parseGithubWebUrl("ssh://git@github.com:22/owner/repo.git")).toBe(REPO);
  });

  it("maps HTTPS remotes, with or without .git and credentials", () => {
    expect(parseGithubWebUrl("https://github.com/owner/repo.git")).toBe(REPO);
    expect(parseGithubWebUrl("https://github.com/owner/repo")).toBe(REPO);
    expect(parseGithubWebUrl("https://user:token@github.com/owner/repo.git")).toBe(REPO);
  });

  it("maps the git:// protocol", () => {
    expect(parseGithubWebUrl("git://github.com/owner/repo.git")).toBe(REPO);
  });

  it("trims surrounding whitespace / trailing newline (git output)", () => {
    expect(parseGithubWebUrl("  git@github.com:owner/repo.git\n")).toBe(REPO);
  });

  it("is case-insensitive on the host and strips only a trailing .git", () => {
    expect(parseGithubWebUrl("git@GitHub.com:owner/repo.GIT")).toBe(REPO);
    expect(parseGithubWebUrl("https://github.com/owner/repo.github.git")).toBe("https://github.com/owner/repo.github");
  });

  it("returns null for non-GitHub hosts", () => {
    expect(parseGithubWebUrl("git@gitlab.com:owner/repo.git")).toBeNull();
    expect(parseGithubWebUrl("https://bitbucket.org/owner/repo.git")).toBeNull();
    expect(parseGithubWebUrl("git@github.example.com:owner/repo.git")).toBeNull(); // not github.com
  });

  it("returns null for empty, malformed, or under-specified remotes", () => {
    expect(parseGithubWebUrl("")).toBeNull();
    expect(parseGithubWebUrl("   ")).toBeNull();
    expect(parseGithubWebUrl("not a url")).toBeNull();
    expect(parseGithubWebUrl("https://github.com/owner")).toBeNull(); // no repo segment
    expect(parseGithubWebUrl("https://github.com/")).toBeNull();
  });
});

describe("resolveGithubUrl", () => {
  it("maps this repo's origin to its github.com URL", async () => {
    expect(await resolveGithubUrl(process.cwd())).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  });

  it("returns null for a non-git directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gitremote-"));
    try {
      expect(await resolveGithubUrl(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
}
function makeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
}

type RouteHandler = (req: { headers: { origin?: string }; body: unknown }, res: FakeRes) => unknown;

// Capture the route's handler so it can be invoked with mock req/res — no HTTP
// server needed (mirrors how the other server specs exercise units directly).
function captureHandler(isAllowedOrigin: (o?: string) => boolean): RouteHandler {
  let handler: RouteHandler | undefined;
  const app = {
    post(_path: string, h: RouteHandler) {
      handler = h;
    },
  } as unknown as Express;
  mountGitRemoteRoute(app, { isAllowedOrigin });
  if (!handler) throw new Error("route was not mounted");
  return handler;
}

function githubUrlOf(payload: unknown): string | null {
  return payload && typeof payload === "object" && "githubUrl" in payload ? (payload as { githubUrl: string | null }).githubUrl : null;
}

const allow = () => true;
const deny = () => false;

describe("mountGitRemoteRoute (POST /api/git-remote)", () => {
  it("rejects a disallowed origin with 403", async () => {
    const res = makeRes();
    await captureHandler(deny)({ headers: { origin: "https://evil.example" }, body: { path: process.cwd() } }, res);
    expect(res.statusCode).toBe(403);
  });

  it("requires an absolute path (400)", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: "relative/dir" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("404s a non-existent directory", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: path.join(os.tmpdir(), "no-such-dir-xyz-123456") } }, res);
    expect(res.statusCode).toBe(404);
  });

  it("400s a path that exists but isn't a directory", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: path.join(process.cwd(), "package.json") } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("returns the GitHub URL for a git repo", async () => {
    const res = makeRes();
    await captureHandler(allow)({ headers: {}, body: { path: process.cwd() } }, res);
    expect(res.statusCode).toBe(200);
    expect(githubUrlOf(res.payload)).toMatch(/^https:\/\/github\.com\//);
  });

  it("returns githubUrl: null for a non-git directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gitremote-"));
    try {
      const res = makeRes();
      await captureHandler(allow)({ headers: {}, body: { path: dir } }, res);
      expect(res.statusCode).toBe(200);
      expect(githubUrlOf(res.payload)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
