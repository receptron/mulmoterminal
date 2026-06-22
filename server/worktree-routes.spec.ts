import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Express } from "express";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { mountWorktreeRoutes } from "./worktree-routes.js";
import { createWorktree, worktreesRoot } from "./worktrees.js";

interface FakeRes {
  statusCode: number;
  payload: unknown;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  end(): FakeRes;
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
    end() {
      return this;
    },
  };
}

type Handler = (req: { headers: { origin?: string }; query?: Record<string, unknown>; body?: unknown }, res: FakeRes) => unknown;

// Capture the mounted handlers keyed by "METHOD path" so each can be invoked with
// a mock req/res — no HTTP server needed (mirrors gitRemote.spec).
function routes(isAllowedOrigin: (o?: string) => boolean): Record<string, Handler> {
  const map: Record<string, Handler> = {};
  const app = {
    get(p: string, h: Handler) {
      map[`GET ${p}`] = h;
    },
    post(p: string, h: Handler) {
      map[`POST ${p}`] = h;
    },
  } as unknown as Express;
  mountWorktreeRoutes(app, { isAllowedOrigin });
  return map;
}

const allow = () => true;
const deny = () => false;

describe("worktree routes: origin guard + validation", () => {
  it("rejects create and remove from a disallowed origin (403)", async () => {
    const r = routes(deny);
    const c = makeRes();
    await r["POST /api/worktrees/create"]({ headers: { origin: "https://evil.example" }, body: { repoDir: "/x", task: "t" } }, c);
    expect(c.statusCode).toBe(403);
    const d = makeRes();
    await r["POST /api/worktrees/remove"]({ headers: { origin: "https://evil.example" }, body: { repoDir: "/x", path: "/y" } }, d);
    expect(d.statusCode).toBe(403);
  });

  it("400s create when the task is missing or blank", async () => {
    const r = routes(allow);
    const a = makeRes();
    await r["POST /api/worktrees/create"]({ headers: {}, body: { repoDir: "/x" } }, a);
    expect(a.statusCode).toBe(400);
    const b = makeRes();
    await r["POST /api/worktrees/create"]({ headers: {}, body: { repoDir: "/x", task: "   " } }, b);
    expect(b.statusCode).toBe(400);
  });

  it("400s remove when repoDir or path is missing", async () => {
    const r = routes(allow);
    const res = makeRes();
    await r["POST /api/worktrees/remove"]({ headers: {}, body: { repoDir: "/x" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("reports isGit:false for a non-git dir", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wt-routes-plain-"));
    try {
      const res = makeRes();
      await routes(allow)["GET /api/worktrees"]({ headers: {}, query: { cwd: dir } }, res);
      expect(res.payload).toEqual({ isGit: false, base: null, worktrees: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("GET /api/worktrees/diff returns isWorktree:false for a missing/non-worktree cwd", async () => {
    const r = routes(allow);
    const a = makeRes();
    await r["GET /api/worktrees/diff"]({ headers: {}, query: {} }, a); // no cwd
    expect(a.payload).toMatchObject({ isWorktree: false, files: [], patch: "" });
    const b = makeRes();
    await r["GET /api/worktrees/diff"]({ headers: {}, query: { cwd: "/no/such/dir" } }, b);
    expect(b.payload).toMatchObject({ isWorktree: false });
  });
});

// Drive the real create → list → remove lifecycle through the HTTP handlers,
// against a temp git repo with the managed root redirected to a temp dir.
describe("worktree routes: create → list → remove lifecycle", () => {
  let repo: string;
  let home: string;
  const hasGit = (() => {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "wt-routes-home-")));
    process.env.MULMOTERMINAL_HOME = home;
    repo = realpathSync(mkdtempSync(path.join(tmpdir(), "wt-routes-repo-")));
    if (!hasGit) return;
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' from PATH in a test; argv only, no shell
    const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { stdio: "ignore" });
    g("init", "-b", "main");
    g("config", "user.email", "t@t.t");
    g("config", "user.name", "t");
    writeFileSync(path.join(repo, "README.md"), "hi");
    g("add", "-A");
    g("commit", "-m", "init");
  });
  afterEach(() => {
    delete process.env.MULMOTERMINAL_HOME;
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it.skipIf(!hasGit)("creates, lists (with dirty), refuses a dirty remove, then force-removes", async () => {
    const r = routes(allow);

    const created = makeRes();
    await r["POST /api/worktrees/create"]({ headers: {}, body: { repoDir: repo, task: "Fix Login" } }, created);
    expect(created.statusCode).toBe(200);
    const wt = created.payload as { path: string; branch: string };
    expect(wt.branch).toBe("agent/fix-login");

    const listed = makeRes();
    await r["GET /api/worktrees"]({ headers: {}, query: { cwd: repo } }, listed);
    const body = listed.payload as { isGit: boolean; base: string; worktrees: { task: string; dirty: boolean }[] };
    expect(body.isGit).toBe(true);
    expect(body.worktrees).toEqual([{ path: wt.path, branch: "agent/fix-login", head: expect.any(String), task: "fix-login", dirty: false }]);

    writeFileSync(path.join(wt.path, "new.txt"), "x");
    const listed2 = makeRes();
    await r["GET /api/worktrees"]({ headers: {}, query: { cwd: repo } }, listed2);
    expect((listed2.payload as { worktrees: { dirty: boolean }[] }).worktrees[0].dirty).toBe(true);

    const refused = makeRes();
    await r["POST /api/worktrees/remove"]({ headers: {}, body: { repoDir: repo, path: wt.path } }, refused);
    expect(refused.statusCode).toBe(409);
    expect(refused.payload).toEqual({ ok: false, reason: "dirty" });

    const removed = makeRes();
    await r["POST /api/worktrees/remove"]({ headers: {}, body: { repoDir: repo, path: wt.path, force: true, deleteBranch: true } }, removed);
    expect(removed.statusCode).toBe(200);
    expect(removed.payload).toEqual({ ok: true });

    const empty = makeRes();
    await r["GET /api/worktrees"]({ headers: {}, query: { cwd: repo } }, empty);
    expect((empty.payload as { worktrees: unknown[] }).worktrees).toEqual([]);
  });

  it.skipIf(!hasGit)("409s a remove of the main checkout (not under the managed root)", async () => {
    const res = makeRes();
    await routes(allow)["POST /api/worktrees/remove"]({ headers: {}, body: { repoDir: repo, path: repo } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual({ ok: false, reason: "not-managed" });
  });

  it.skipIf(!hasGit)("treats a non-boolean force as false (no accidental force-delete of a dirty worktree)", async () => {
    const r = routes(allow);
    const created = makeRes();
    await r["POST /api/worktrees/create"]({ headers: {}, body: { repoDir: repo, task: "wip" } }, created);
    const wt = created.payload as { path: string };
    writeFileSync(path.join(wt.path, "dirty.txt"), "x"); // make it dirty

    // the string "false" is truthy in JS — strict validation must NOT force-remove
    const res = makeRes();
    await r["POST /api/worktrees/remove"]({ headers: {}, body: { repoDir: repo, path: wt.path, force: "false", deleteBranch: "false" } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.payload).toEqual({ ok: false, reason: "dirty" });
  });

  it.skipIf(!hasGit)("500s an internal git failure (managed path, but not a registered worktree)", async () => {
    await createWorktree(repo, "real"); // makes the managed root dir exist
    const ghost = path.join(worktreesRoot(repo), "ghost"); // under the root, but no worktree there
    const res = makeRes();
    await routes(allow)["POST /api/worktrees/remove"]({ headers: {}, body: { repoDir: repo, path: ghost } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ ok: false, reason: "failed" });
  });
});
