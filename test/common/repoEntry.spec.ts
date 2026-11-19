// Reading a configured repository entry. Shared by the server (which CLI to run) and the browser
// (why a control is off), so the two cannot disagree — writing the rule twice is what this file
// exists to prevent (#981).
import { describe, it, expect } from "vitest";
import { canonicalRepo, parseRepoEntry, repoIdentity, GITHUB_HOST, githubRepoName } from "../../common/repoEntry";

describe("parseRepoEntry", () => {
  it("implies github.com for a bare owner/repo", () => {
    expect(parseRepoEntry("acme/web")).toEqual({ host: GITHUB_HOST, path: ["acme", "web"], declared: false });
  });

  // A dot in the first segment is the host: GitHub owner and organisation names may hold only
  // alphanumerics and hyphens, so the two forms cannot be confused.
  it.each([
    ["gitlab.com/group/project", "gitlab.com", ["group", "project"]],
    ["gitlab.com/group/sub/project", "gitlab.com", ["group", "sub", "project"]],
    ["git.example.com/team/project", "git.example.com", ["team", "project"]],
  ])("reads the host out of %s", (entry, host, path) => {
    expect(parseRepoEntry(entry)).toEqual({ host, path, declared: true });
  });

  it("lower-cases a shouted host", () => {
    expect(parseRepoEntry("GitLab.COM/group/project")?.host).toBe("gitlab.com");
  });

  // An empty segment is a doubled, leading or trailing slash. Forgiving it would let `owner//repo`
  // parse while the entry is STORED verbatim and handed to a CLI that rejects it.
  it.each([["owner//repo"], ["/owner/repo"], ["owner/repo/"], [""], ["   "], ["/"]])("returns null for %s", (entry) => {
    expect(parseRepoEntry(entry)).toBeNull();
  });
});

describe("canonicalRepo", () => {
  // The identity `/api/repo-dirs` keys by: it reads the name off a clone's remote, where the host
  // is not part of the path. An entry that spells the host out has to be reduced to it before any
  // comparison, or a repo with a clone reads as having none.
  it.each([
    ["acme/web", "acme/web"],
    ["github.com/acme/web", "acme/web"],
    ["gitlab.com/group/sub/project", "group/sub/project"],
  ])("reduces %s to %s", (entry, expected) => {
    expect(canonicalRepo(entry)).toBe(expected);
  });

  it("leaves something it cannot parse alone rather than inventing a name", () => {
    expect(canonicalRepo("owner//repo")).toBe("owner//repo");
  });
});

// Two different questions about one entry, and using the wrong one for the wrong job is how a
// GitHub clone came to answer for a GitLab repo (#981 step 4c-1).
describe("repoIdentity vs canonicalRepo", () => {
  // MATCHING keeps the host: a configured entry is compared against a resolved clone, and without
  // the host two projects of the same path on different forges collapse into one.
  it("keeps a GitHub and a GitLab project of the same path apart", () => {
    expect(repoIdentity("gitlab.com/a/b")).not.toBe(repoIdentity("github.com/a/b"));
  });

  it("treats a bare entry and its host-qualified spelling as the same repo", () => {
    expect(repoIdentity("acme/web")).toBe(repoIdentity("github.com/acme/web"));
    expect(repoIdentity("acme/web")).toBe(repoIdentity("GitHub.com/Acme/Web"));
  });

  // The CLI question is the opposite one: `--repo` wants the project as its own host names it.
  it("strips the host for the CLI while matching keeps it", () => {
    expect(canonicalRepo("gitlab.com/group/project")).toBe("group/project");
    expect(repoIdentity("gitlab.com/group/project")).toBe("gitlab.com/group/project");
  });
});

describe("githubRepoName", () => {
  it.each([
    ["receptron/mulmoterminal", "receptron/mulmoterminal"],
    ["github.com/Receptron/MulmoTerminal", "Receptron/MulmoTerminal"],
    ["GitHub.com/o/r", "o/r"],
    ["gitlab.com/group/project", null],
    ["gitlab.com/group/sub/project", null],
    ["github.example.com/o/r", null],
    ["github.com/o/r/extra", null],
    ["o", null],
    ["o//r", null],
    ["", null],
  ])("%s → %s", (entry, name) => {
    expect(githubRepoName(entry)).toBe(name);
  });
});
