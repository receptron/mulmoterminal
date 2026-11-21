// @vitest-environment node
import { describe, it, expect } from "vitest";
import { unconfiguredRepos } from "../../../server/git/board-repos";

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
