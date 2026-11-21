// @vitest-environment node
// GET /api/prs and /api/issues read the configured repos and then the GitHub repos a live terminal is
// in (#3377): an unregistered one is marked, and left out when `gh` cannot read it.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { fakePtyEntry } from "../../helpers/fakePtyEntry.js";

// A repo named `x/unreadable` fails as an inaccessible one does; every other answers an empty list.
const runGh = vi.hoisted(() =>
  vi.fn(async (args: string[]) =>
    args.includes("x/unreadable") ? { ok: false, stdout: "", stderr: "Could not resolve to a Repository" } : { ok: true, stdout: "[]", stderr: "" },
  ),
);
vi.mock("../../../server/git/gh.js", () => ({ runGh }));
vi.mock("../../../server/git/git-status.js", () => ({ currentBranch: vi.fn(async () => ({ branch: "main", detached: false })) }));
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

const reposOf = async (path: string): Promise<{ repo: string; unregistered?: boolean; error?: string }[]> => {
  const body: unknown = await (await fetch(`${base}${path}`)).json();
  return typeof body === "object" && body !== null && "repos" in body && Array.isArray(body.repos) ? body.repos : [];
};

describe.each(["/api/prs", "/api/issues"])("GET %s", (path) => {
  it("is the configured repos alone with no terminal open", async () => {
    expect((await reposOf(path)).map((repo) => [repo.repo, repo.unregistered])).toEqual([["o/configured", undefined]]);
  });

  it("adds the repo a terminal is open in after the configured ones, marked unregistered", async () => {
    ptys.set("s1", fakePtyEntry({ cwd: "/w/x/live" }));
    expect((await reposOf(path)).map((repo) => [repo.repo, repo.unregistered])).toEqual([
      ["o/configured", undefined],
      ["x/live", true],
    ]);
  });

  it("does not add a configured repo twice when a terminal is open in it", async () => {
    ptys.set("s1", fakePtyEntry({ cwd: "/w/o/configured" }));
    expect((await reposOf(path)).map((repo) => repo.repo)).toEqual(["o/configured"]);
  });

  it("leaves out an unregistered repo gh cannot read, and one not on GitHub", async () => {
    ptys.set("s1", fakePtyEntry({ cwd: "/w/x/unreadable" }));
    ptys.set("s2", fakePtyEntry({ cwd: "/w/gitlab/g/p" }));
    expect(await reposOf(path)).toEqual([expect.objectContaining({ repo: "o/configured" })]);
  });
});
