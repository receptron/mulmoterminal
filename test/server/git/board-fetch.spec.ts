// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

const runGh = vi.hoisted(() =>
  vi.fn(async (args: string[]) => {
    if (args[1] === "view" && args[2] === "99") return { ok: false, stdout: "", stderr: "Could not resolve to an Issue" };
    if (args[0] === "issue" && args[1] === "view")
      return { ok: true, stdout: JSON.stringify({ number: Number(args[2]), url: "https://github.com/o/r/issues/4", body: "b" }), stderr: "" };
    if (args[0] === "pr" && args[1] === "view")
      return { ok: true, stdout: JSON.stringify({ number: Number(args[2]), url: "https://github.com/o/r/pull/5" }), stderr: "" };
    if (args[0] === "repo") return args.includes("o/no-default") ? { ok: false, stdout: "", stderr: "no access" } : { ok: true, stdout: "main\n", stderr: "" };
    if (args[0] === "pr" && args.includes("merged")) {
      const review = { authorAssociation: "OWNER", submittedAt: "2026-10-26T04:00:00Z", body: "CODEX VERDICT: LGTM (head abc1234)" };
      return { ok: true, stdout: JSON.stringify([{ number: 6, url: "https://github.com/o/r/pull/6", headRefName: "feat/y", reviews: [review] }]), stderr: "" };
    }
    if (args[0] === "pr" && args.includes("open")) {
      const verdict = { authorAssociation: "MEMBER", createdAt: "2026-10-26T04:00:00Z", body: "CODEX VERDICT: LGTM (head abc1234)" };
      const pr = { number: 5, title: "t", url: "https://github.com/o/r/pull/5", headRefName: "feat/x", headRefOid: "abc1234def", comments: [verdict] };
      return { ok: true, stdout: JSON.stringify([pr]), stderr: "" };
    }
    return { ok: true, stdout: "[]", stderr: "" };
  }),
);
vi.mock("../../../server/git/gh.js", () => ({ runGh }));
// A directory's HEAD by its path: `/w/main/...` on main, `/w/detached/...` detached, `/w/unborn/...`
// with no HEAD at all, anything else on feat/x.
const currentBranch = vi.hoisted(() =>
  vi.fn(async (dir: string) => {
    if (dir.startsWith("/w/main/")) return { branch: "main", detached: false };
    if (dir.startsWith("/w/detached/")) return { branch: null, detached: true };
    if (dir.startsWith("/w/unborn/")) return { branch: null, detached: false };
    return { branch: "feat/x", detached: false };
  }),
);
vi.mock("../../../server/git/git-status.js", () => ({ currentBranch }));
// A directory's repo by its path: `/w/<owner>/<repo>`, on the host `/w/gitlab/...` names, else GitHub.
const repoForDir = vi.hoisted(() =>
  vi.fn(async (dir: string) => {
    if (dir === "/w/a") return { forge: { kind: "github", host: "github.com", path: "o/r" }, repo: "o/r" };
    if (dir.startsWith("/w/gitlab/")) return { forge: { kind: "gitlab", host: "gitlab.com", path: "g/p" }, repo: "gitlab.com/g/p" };
    const repo = dir.replace(/^\/w\/((main|detached|unborn)\/)?/, "");
    return { forge: { kind: "github", host: "github.com", path: repo }, repo };
  }),
);
vi.mock("../../../server/git/forge-support.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/git/forge-support.js")>()),
  repoForDir,
}));

const { boardAcrossRepos, boardDetail, liveCellRepos } = await import("../../../server/git/board-fetch");

const cell = { session: "s1", cwd: "/w/a", working: true, waiting: false };

describe("boardAcrossRepos", () => {
  it.each(["o/r", "O/R", "github.com/o/r"])("places a cell on the PR of its branch when the repo is configured as %s", async (entry) => {
    const [board] = await boardAcrossRepos([entry], [cell]);
    expect(board?.cards?.find((card) => card.key === "pr-5")?.cells.map((c) => c.session)).toEqual(["s1"]);
  });

  it("reads comments, and so codex verdicts, for open PRs only", async () => {
    runGh.mockClear();
    const [board] = await boardAcrossRepos(["o/r"], []);
    expect(board?.cards?.find((card) => card.key === "pr-5")?.pr?.codex).toEqual({ verdicts: 1, more: false, latest: "lgtm", head: "current" });
    const fieldsFor = (state: string): string[] => {
      const call = runGh.mock.calls.find(([args]) => args[1] === "list" && args.includes(state));
      return (call?.[0][call[0].indexOf("--json") + 1] ?? "").split(",");
    };
    expect(fieldsFor("open")).toContain("comments");
    expect(fieldsFor("merged")).not.toContain("comments");
    expect(fieldsFor("merged")).toContain("reviews");
    // A merged row has its reviews but not its comments, so a review-body verdict is not a whole count.
    expect(board?.cards?.find((card) => card.key === "pr-6")?.pr?.codex).toBeNull();
  });

  it("answers a non-GitHub repo with its own error", async () => {
    const [board] = await boardAcrossRepos(["gitlab.com/g/p"], [cell]);
    expect(board?.cards).toBeUndefined();
    expect(board?.error).toBeTruthy();
  });
});

describe("boardAcrossRepos with a cell in a repo that is not configured", () => {
  const elsewhere = { session: "s2", cwd: "/w/x/y", working: false, waiting: false };

  it("reads that repo after the configured ones, marked unregistered, with its cell", async () => {
    const boards = await boardAcrossRepos(["o/r"], [cell, elsewhere]);
    expect(boards.map((board) => [board.repo, board.unregistered])).toEqual([
      ["o/r", undefined],
      ["x/y", true],
    ]);
    expect(boards[1]?.cards?.find((card) => card.key === "pr-5")?.cells.map((c) => c.session)).toEqual(["s2"]);
  });

  it("reads a configured repo once, however its cell names it", async () => {
    const boards = await boardAcrossRepos(["github.com/O/R"], [cell]);
    expect(boards.map((board) => board.repo)).toEqual(["O/R"]);
  });

  it("leaves out one gh cannot read rather than showing an error", async () => {
    const broken = { session: "s3", cwd: "/w/x/broken", working: false, waiting: false };
    const usual = runGh.getMockImplementation();
    runGh.mockImplementation(async (args: string[]) =>
      args.includes("x/broken") ? { ok: false, stdout: "", stderr: "no access" } : (usual?.(args) ?? { ok: true, stdout: "[]", stderr: "" }),
    );
    try {
      expect(await boardAcrossRepos([], [broken])).toEqual([]);
    } finally {
      if (usual) runGh.mockImplementation(usual);
    }
  });

  it("does not read a repo off GitHub that no one configured", async () => {
    expect(await boardAcrossRepos([], [{ ...elsewhere, cwd: "/w/gitlab/g/p" }])).toEqual([]);
  });
});

describe("boardAcrossRepos with cells on the default branch or on no branch", () => {
  const at = (session: string, cwd: string) => ({ session, cwd, working: false, waiting: false });

  it("puts them on the repo's mainline row, not on a card", async () => {
    const [board] = await boardAcrossRepos(["o/r2"], [at("m", "/w/main/o/r2"), at("d", "/w/detached/o/r2"), at("b", "/w/o/r2")]);
    expect(board?.mainlineCells?.map((c) => [c.session, c.branch])).toEqual([
      ["m", "main"],
      ["d", null],
    ]);
    expect(board?.cards?.flatMap((card) => card.cells.map((c) => c.session))).toEqual(["b"]);
  });

  it("leaves the row out when no cell is on it", async () => {
    const [board] = await boardAcrossRepos(["o/r2"], [at("b", "/w/o/r2")]);
    expect(board).not.toHaveProperty("mainlineCells");
  });

  it("does not place a cell in a directory with no HEAD", async () => {
    const [board] = await boardAcrossRepos(["o/r2"], [at("u", "/w/unborn/o/r2")]);
    expect(board).not.toHaveProperty("mainlineCells");
    expect(board?.cards?.flatMap((card) => card.cells)).toEqual([]);
  });

  it("gives a cell on main a branch card when the default branch cannot be read, keeping detached ones on the row", async () => {
    const [board] = await boardAcrossRepos(["o/no-default"], [at("m", "/w/main/o/no-default"), at("d", "/w/detached/o/no-default")]);
    expect(board?.cards?.find((card) => card.key === "branch-main")?.cells.map((c) => c.session)).toEqual(["m"]);
    expect(board?.mainlineCells?.map((c) => c.session)).toEqual(["d"]);
  });

  it("reads an unregistered repo whose only terminal is on its default branch", async () => {
    const boards = await boardAcrossRepos([], [at("m", "/w/main/x/only-main")]);
    expect(boards.map((board) => [board.repo, board.unregistered, board.mainlineCells?.length])).toEqual([["x/only-main", true, 1]]);
  });
});

describe("liveCellRepos", () => {
  it("is the GitHub repos the cells are in", async () => {
    const cells = [cell, { ...cell, cwd: "/w/x/y" }, { ...cell, cwd: "/w/gitlab/g/p" }];
    expect((await liveCellRepos(cells)).sort()).toEqual(["o/r", "x/y"]);
  });
});

describe("boardDetail", () => {
  it("reads the issue and the PR of a configured repo, asking gh by owner/repo", async () => {
    const detail = await boardDetail("o/r", ["github.com/O/R"], 4, 5);
    expect(detail).toMatchObject({ issue: { number: 4, body: "b" }, pr: { number: 5 }, errors: [] });
    expect(runGh).toHaveBeenCalledWith(["issue", "view", "4", "--repo", "O/R", "--json", expect.any(String)]);
  });

  it("still shows one part when the other cannot be read", async () => {
    const detail = await boardDetail("o/r", ["o/r"], 99, 5);
    expect(detail?.issue).toBeNull();
    expect(detail?.pr).toMatchObject({ number: 5 });
    expect(detail?.errors).toEqual(["issue #99: Could not resolve to an Issue"]);
  });

  it("asks gh only for the parts requested", async () => {
    runGh.mockClear();
    expect(await boardDetail("o/r", ["o/r"], null, 5)).toMatchObject({ issue: null, pr: { number: 5 } });
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it("is null for a repo that is not configured, or not on GitHub", async () => {
    expect(await boardDetail("o/other", ["o/r"], 4, null)).toBeNull();
    expect(await boardDetail("gitlab.com/g/p", ["gitlab.com/g/p"], 4, null)).toBeNull();
  });
});
