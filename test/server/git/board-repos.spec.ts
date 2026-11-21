// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unconfiguredRepos, withUnregisteredLists } from "../../../server/git/board-repos";

describe("unconfiguredRepos", () => {
  it("is the cell repos that are not configured, sorted", () => {
    expect(unconfiguredRepos(["o/r"], ["z/b", "o/r", "a/c"])).toEqual(["a/c", "z/b"]);
  });

  it.each(["O/R", "github.com/o/r", "github.com/O/R"])("treats a configured %s as the same repo as o/r", (entry) => {
    expect(unconfiguredRepos([entry], ["o/r"])).toEqual([]);
  });

  it("names a repo once, by the spelling first seen", () => {
    expect(unconfiguredRepos([], ["o/X", "o/x"])).toEqual(["o/X"]);
  });

  it("does not take a GitLab entry of the same path for the GitHub repo", () => {
    expect(unconfiguredRepos(["gitlab.com/o/r"], ["o/r"])).toEqual(["o/r"]);
  });

  it("is empty with no cells, configured repos or not", () => {
    expect(unconfiguredRepos([], [])).toEqual([]);
    expect(unconfiguredRepos(["o/r"], [])).toEqual([]);
  });
});

type Row = { repo: string; error?: string; unregistered?: boolean };

const fakeList = async (repos: string[]): Promise<Row[]> => repos.map((repo) => (repo.startsWith("bad/") ? { repo, error: "no access" } : { repo }));

describe("withUnregisteredLists", () => {
  it("is the configured rows, then the unregistered ones marked", async () => {
    expect(await withUnregisteredLists(["o/a", "o/b"], ["x/c"], fakeList)).toEqual([{ repo: "o/a" }, { repo: "o/b" }, { repo: "x/c", unregistered: true }]);
  });

  it("keeps a configured repo's error and drops an unregistered one's", async () => {
    expect(await withUnregisteredLists(["bad/a"], ["bad/b", "x/c"], fakeList)).toEqual([
      { repo: "bad/a", error: "no access" },
      { repo: "x/c", unregistered: true },
    ]);
  });

  it("asks the list once for each group, unregistered with nothing to read", async () => {
    const calls: string[][] = [];
    const list = async (repos: string[]): Promise<Row[]> => {
      calls.push(repos);
      return fakeList(repos);
    };
    expect(await withUnregisteredLists(["o/a"], [], list)).toEqual([{ repo: "o/a" }]);
    expect(calls).toEqual([["o/a"], []]);
  });
});
