// @vitest-environment node
// GET /api/github/board/detail decides which repos `gh` may be asked about: the configured ones and
// the GitHub repos a live terminal is in, never one the query names on its own.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fakePtyEntry } from "../../helpers/fakePtyEntry.js";

const runGh = vi.hoisted(() => vi.fn(async (args: string[]) => ({ ok: true, stdout: JSON.stringify({ number: Number(args[2]) }), stderr: "" })));
vi.mock("../../../server/git/gh.js", () => ({ runGh }));
vi.mock("../../../server/git/git-status.js", () => ({ currentBranch: vi.fn(async () => ({ branch: "feat/x", detached: false })) }));
// A directory's repo by its path: `/w/gitlab/...` is on GitLab, `/w/<owner>/<repo>` on GitHub.
vi.mock("../../../server/git/forge-support.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/git/forge-support.js")>()),
  repoForDir: vi.fn(async (dir: string) => {
    const project = dir.replace(/^\/w\/(gitlab\/)?/, "");
    return dir.startsWith("/w/gitlab/")
      ? { forge: { kind: "gitlab", host: "gitlab.com", path: project }, repo: `gitlab.com/${project}` }
      : { forge: { kind: "github", host: "github.com", path: project }, repo: project };
  }),
}));
vi.mock("../../../server/config/config-routes.js", () => ({
  getCwdPresets: () => [],
  getRepoDirs: () => ({}),
  getPrRepos: () => ["o/configured"],
  getAutoDirIcon: () => false,
}));

const { mountRepoRoutes } = await import("../../../server/routes/repo-routes.js");
const { ptys } = await import("../../../server/session/registry.js");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  mountRepoRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address: AddressInfo | string | null = server.address();
  base = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

afterEach(() => {
  ptys.clear();
  runGh.mockClear();
});

const statusFor = async (repo: string): Promise<number> => (await fetch(`${base}/api/github/board/detail?repo=${repo}&issue=1`)).status;

describe("GET /api/github/board/detail", () => {
  it("answers for a configured repo", async () => {
    expect(await statusFor("o/configured")).toBe(200);
  });

  it("answers for a repo a terminal is open in, and asks gh about that repo", async () => {
    ptys.set("s1", fakePtyEntry({ cwd: "/w/x/live" }));
    expect(await statusFor("x/live")).toBe(200);
    expect(runGh).toHaveBeenCalledWith(["issue", "view", "1", "--repo", "x/live", "--json", expect.any(String)]);
  });

  it("refuses a repo neither configured nor with a terminal, without asking gh", async () => {
    ptys.set("s1", fakePtyEntry({ cwd: "/w/x/live" }));
    expect(await statusFor("x/other")).toBe(404);
    expect(runGh).not.toHaveBeenCalled();
  });

  it("refuses a repo whose terminal is on a forge other than GitHub", async () => {
    ptys.set("s1", fakePtyEntry({ cwd: "/w/gitlab/g/p" }));
    expect(await statusFor("gitlab.com/g/p")).toBe(404);
    expect(runGh).not.toHaveBeenCalled();
  });
});
