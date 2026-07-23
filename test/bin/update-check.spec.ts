import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isNewerVersion,
  fetchLatestVersion,
  isUpdateCheckDisabled,
  hasNodeModulesSegment,
  classifyInstall,
  parseLsRemoteHead,
  parseLsRemoteDefaultBranch,
  isSafeBranchName,
  npmUpdateNotice,
  isTreeDirtyForUpdate,
  gitUpdateNotice,
  computeUpdateNotice,
} from "../../bin/update-check.js";

describe("isNewerVersion", () => {
  const cases: [string, string, boolean][] = [
    ["0.1.3", "0.1.0", true],
    ["0.2.0", "0.1.9", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.10", "0.1.9", true], // numeric, not lexical (the bug a string compare hits)
    ["0.1.3", "0.1.3", false],
    ["0.1.0", "0.1.3", false],
    ["0.9.9", "1.0.0", false],
    ["0.1.4-beta.1", "0.1.3", true], // pre-release suffix ignored on the core
    ["0.1.3", "0.1.3-beta.1", false], // equal core → not newer
  ];
  it.each(cases)("isNewerVersion(%s, %s) === %s", (latest, current, expected) => {
    expect(isNewerVersion(latest, current)).toBe(expected);
  });
});

describe("fetchLatestVersion", () => {
  const stubFetch = (impl: () => Promise<unknown>) => vi.stubGlobal("fetch", vi.fn(impl));
  afterEach(() => vi.unstubAllGlobals());

  it("returns the version from a 200 response", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: "1.2.3" }) }));
    expect(await fetchLatestVersion()).toBe("1.2.3");
  });

  it("returns null on a non-OK response", async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when fetch rejects (offline / timeout)", async () => {
    stubFetch(async () => {
      throw new Error("offline");
    });
    expect(await fetchLatestVersion()).toBeNull();
  });

  it("returns null when the payload has no version string", async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ name: "mulmoterminal" }) }));
    expect(await fetchLatestVersion()).toBeNull();
  });
});

describe("isUpdateCheckDisabled", () => {
  it("is silent for neither switch set", () => {
    expect(isUpdateCheckDisabled({})).toBe(false);
  });

  // The namespaced switch silences only this tool.
  it("respects the namespaced opt-out", () => {
    expect(isUpdateCheckDisabled({ MULMOTERMINAL_NO_UPDATE_CHECK: "1" })).toBe(true);
  });

  // NO_UPDATE_NOTIFIER is the ecosystem-wide convention; honouring it means a
  // user who silenced every tool's notice does not have to name this one too.
  it("respects the ecosystem-wide opt-out", () => {
    expect(isUpdateCheckDisabled({ NO_UPDATE_NOTIFIER: "1" })).toBe(true);
  });
});

describe("hasNodeModulesSegment", () => {
  it("spots a global install", () => {
    expect(hasNodeModulesSegment("/usr/local/lib/node_modules/mulmoterminal")).toBe(true);
  });

  // Windows separators count too, or every Windows global install misreads as git.
  it("spots a global install with Windows separators", () => {
    expect(hasNodeModulesSegment("C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\mulmoterminal")).toBe(true);
  });

  it("does not see one in a plain checkout", () => {
    expect(hasNodeModulesSegment("/home/dev/src/mulmoterminal")).toBe(false);
  });

  // A directory that merely contains the substring is not the segment — only a
  // real path component named exactly node_modules makes it an npm install.
  it("matches the segment, not the substring", () => {
    expect(hasNodeModulesSegment("/home/dev/node_modules_backup/mulmoterminal")).toBe(false);
  });
});

describe("classifyInstall", () => {
  // node_modules wins even inside a git work tree: a dependency vendored into
  // another project sits under the parent repo, and must not be read as a git
  // install of this tool.
  it("calls a node_modules path npm even when git says work tree", () => {
    expect(classifyInstall("/proj/node_modules/mulmoterminal", true)).toBe("npm");
  });

  it("calls a bare checkout git", () => {
    expect(classifyInstall("/home/dev/mulmoterminal", true)).toBe("git");
  });

  // Not a work tree and not under node_modules (e.g. an unpacked tarball) falls
  // back to the npm path — the git checks would find nothing to compare against.
  it("falls back to npm when it is neither", () => {
    expect(classifyInstall("/opt/mulmoterminal", false)).toBe("npm");
  });
});

describe("parseLsRemoteHead", () => {
  it("reads the sha HEAD points to", () => {
    expect(parseLsRemoteHead("88a82bc1f5abb50328b27aea3ae50a196ba3fc12\tHEAD")).toBe("88a82bc1f5abb50328b27aea3ae50a196ba3fc12");
  });

  // A SHA-256 repository emits a 64-char object id; a SHA-1-length cap would drop it and
  // silence update notices for that repo even when behind.
  it("reads a 64-char SHA-256 HEAD id", () => {
    const sha256 = "a".repeat(64);
    expect(parseLsRemoteHead(`${sha256}\tHEAD`)).toBe(sha256);
  });

  // It must key off the HEAD ref, not the first line — a stray line without HEAD
  // should never be mistaken for the answer.
  it("finds HEAD among other refs", () => {
    const out = "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/heads/x\nbbbb2222bbbb2222bbbb2222bbbb2222bbbb2222\tHEAD";
    expect(parseLsRemoteHead(out)).toBe("bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222");
  });

  it("returns null for empty or missing output", () => {
    expect(parseLsRemoteHead("")).toBeNull();
    expect(parseLsRemoteHead(null)).toBeNull();
    expect(parseLsRemoteHead(undefined)).toBeNull();
  });

  // A HEAD line whose first field is not a sha is not a usable answer.
  it("rejects a non-sha in the HEAD line", () => {
    expect(parseLsRemoteHead("not-a-sha\tHEAD")).toBeNull();
  });

  // The sha is still readable from --symref output (the ref: line's first field isn't a sha).
  it("reads the sha out of --symref output too", () => {
    expect(parseLsRemoteHead("ref: refs/heads/main\tHEAD\nd451b53dfcda7ef7395bed8a04cf5e1060d6e55f\tHEAD")).toBe("d451b53dfcda7ef7395bed8a04cf5e1060d6e55f");
  });
});

describe("parseLsRemoteDefaultBranch", () => {
  it("reads the default branch from a --symref line", () => {
    expect(parseLsRemoteDefaultBranch("ref: refs/heads/main\tHEAD\nd451b53\tHEAD")).toBe("main");
    expect(parseLsRemoteDefaultBranch("ref: refs/heads/master\tHEAD\nabc\tHEAD")).toBe("master");
  });

  // Without --symref (or on odd output) there's no ref line — fall back to null → bare git pull.
  it("is null when there is no ref line", () => {
    expect(parseLsRemoteDefaultBranch("d451b53\tHEAD")).toBeNull();
    expect(parseLsRemoteDefaultBranch("")).toBeNull();
    expect(parseLsRemoteDefaultBranch(null)).toBeNull();
  });
});

describe("isSafeBranchName", () => {
  it("accepts ordinary branch names", () => {
    for (const name of ["main", "master", "develop", "release/2.x", "feat/update-badge", "v1.2.3", "a_b-c"]) {
      expect(isSafeBranchName(name), name).toBe(true);
    }
  });

  // The name comes from an untrusted remote and lands in a copy/paste shell command; anything
  // that could break out of `git pull origin <name>` must be refused.
  it("rejects names with shell metacharacters", () => {
    for (const name of ["main;rm -rf ~", "main$(whoami)", "a`id`", "a|b", "a&b", "a b", "a>b", "'x'", '"x"', ""]) {
      expect(isSafeBranchName(name), name).toBe(false);
    }
  });

  it("rejects non-strings", () => {
    expect(isSafeBranchName(null)).toBe(false);
    expect(isSafeBranchName(undefined)).toBe(false);
    expect(isSafeBranchName(42)).toBe(false);
  });
});

describe("npmUpdateNotice", () => {
  it("names both versions and the npm command when newer", () => {
    expect(npmUpdateNotice("0.7.0", "0.8.0")).toBe("Update available: 0.7.0 → 0.8.0  ·  run: npm i -g mulmoterminal");
  });

  it("stays silent when current is already latest", () => {
    expect(npmUpdateNotice("0.8.0", "0.8.0")).toBeNull();
    expect(npmUpdateNotice("0.9.0", "0.8.0")).toBeNull();
  });

  // A null latest is what fetchLatestVersion returns offline — no notice, no throw.
  it("stays silent when latest is unknown", () => {
    expect(npmUpdateNotice("0.8.0", null)).toBeNull();
  });
});

describe("gitUpdateNotice", () => {
  // localShort deliberately differs from the first 7 of localSha, so a test can
  // tell whether the notice used the captured short sha or re-sliced the full one.
  const behind = { localSha: "0123456789abcdef", localShort: "short12", remoteSha: "fedcba9876543210", dirty: false };

  it("names the local short sha and a bare git pull when the default branch is unknown", () => {
    expect(gitUpdateNotice(behind)).toBe("Update available: short12 → origin  ·  run: git pull");
  });

  // `git pull` alone pulls the current branch's upstream, not the release. Naming the remote's
  // default branch is what actually updates a clone that's on it (or behind it).
  it("names origin + the default branch when it is known", () => {
    expect(gitUpdateNotice({ ...behind, defaultBranch: "main" })).toBe("Update available: short12 → origin  ·  run: git pull origin main");
    expect(gitUpdateNotice({ ...behind, defaultBranch: "master" })).toContain("git pull origin master");
  });

  // The branch is untrusted remote metadata pasted into a shell — a metachar name must fall
  // back to a bare `git pull`, never inject.
  it("falls back to a bare git pull for an unsafe branch name", () => {
    expect(gitUpdateNotice({ ...behind, defaultBranch: "main;rm -rf ~" })).toBe("Update available: short12 → origin  ·  run: git pull");
    expect(gitUpdateNotice({ ...behind, defaultBranch: "$(whoami)" })).not.toContain("whoami");
  });

  // Dirty stops it even when the shas differ — a checkout with local edits can't
  // fast-forward, so telling it to pull is noise.
  it("stays silent on a dirty tree", () => {
    expect(gitUpdateNotice({ ...behind, dirty: true })).toBeNull();
  });

  it("stays silent when HEAD already matches the remote", () => {
    expect(gitUpdateNotice({ ...behind, remoteSha: behind.localSha })).toBeNull();
  });

  // A null on either side means a git probe failed; guessing would be wrong.
  it("stays silent when local or remote could not be read", () => {
    expect(gitUpdateNotice({ ...behind, localSha: null })).toBeNull();
    expect(gitUpdateNotice({ ...behind, remoteSha: null })).toBeNull();
  });

  // No commit count is shown: counting needs the objects a fetch would bring,
  // and this check deliberately never fetches.
  it("shows no commit count", () => {
    expect(gitUpdateNotice(behind)).not.toContain("commit");
  });

  // Falls back to a trimmed full sha if the short one was not captured.
  it("uses a trimmed sha when the short one is missing", () => {
    expect(gitUpdateNotice({ ...behind, localShort: null })).toContain("0123456 →");
  });
});

describe("isTreeDirtyForUpdate", () => {
  it("treats an empty tree as clean", () => {
    expect(isTreeDirtyForUpdate("")).toBe(false);
    expect(isTreeDirtyForUpdate(null)).toBe(false);
    expect(isTreeDirtyForUpdate(undefined)).toBe(false);
  });

  // The whole point of the review fix: scratch files a working clone accumulates (build
  // output, .env, logs) must not suppress the update notice — git pull proceeds past them.
  it("treats an untracked-only tree as clean", () => {
    expect(isTreeDirtyForUpdate("?? build/out.js")).toBe(false);
    expect(isTreeDirtyForUpdate("?? a.log\n?? .env\n?? node_modules/")).toBe(false);
  });

  it("is dirty on a tracked modification", () => {
    expect(isTreeDirtyForUpdate(" M src/app.ts")).toBe(true);
    expect(isTreeDirtyForUpdate("M  staged.ts")).toBe(true);
    expect(isTreeDirtyForUpdate("A  added.ts")).toBe(true);
    expect(isTreeDirtyForUpdate("UU conflict.ts")).toBe(true);
  });

  // A tracked change hiding among untracked files still counts.
  it("is dirty when a tracked change sits among untracked ones", () => {
    expect(isTreeDirtyForUpdate("?? a.log\n M src/app.ts\n?? b.log")).toBe(true);
  });
});

describe("computeUpdateNotice", () => {
  // A checkout under node_modules is an npm install: it must NOT run git, and the answer
  // comes from the registry vs the bundled version.
  it("takes the npm path for a node_modules dir, without touching git", async () => {
    let gitCalls = 0;
    const notice = await computeUpdateNotice("/proj/node_modules/mulmoterminal", "0.7.0", {
      runGit: async () => {
        gitCalls++;
        return null;
      },
      fetchLatest: async () => "0.8.0",
    });
    expect(notice).toBe("Update available: 0.7.0 → 0.8.0  ·  run: npm i -g mulmoterminal");
    expect(gitCalls).toBe(0);
  });

  it("is silent on the npm path when already latest", async () => {
    const notice = await computeUpdateNotice("/proj/node_modules/mulmoterminal", "0.8.0", {
      runGit: async () => null,
      fetchLatest: async () => "0.8.0",
    });
    expect(notice).toBeNull();
  });

  // A bare checkout is a git install: local HEAD vs the remote's, read via ls-remote.
  it("takes the git path for a checkout and reports behind", async () => {
    const git = async (args: string[]): Promise<string | null> => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true";
      if (args[0] === "status") return ""; // clean
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "0123456789abcdef";
      if (args[0] === "rev-parse" && args[1] === "--short") return "0123456";
      if (args[0] === "ls-remote") return "ref: refs/heads/main\tHEAD\nfedcba9876543210\tHEAD";
      return null;
    };
    const notice = await computeUpdateNotice("/home/dev/mulmoterminal", "0.7.0", { runGit: git, fetchLatest: async () => null });
    expect(notice).toBe("Update available: 0123456 → origin  ·  run: git pull origin main");
  });

  // End to end: a hostile remote whose default branch carries a shell metachar must not reach
  // the pasteable command — the notice falls back to a bare git pull.
  it("does not inject an unsafe remote default branch into the command", async () => {
    const git = async (args: string[]): Promise<string | null> => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true";
      if (args[0] === "status") return "";
      if (args[0] === "rev-parse" && args[1] === "HEAD") return "0123456789abcdef";
      if (args[0] === "rev-parse" && args[1] === "--short") return "0123456";
      if (args[0] === "ls-remote") return "ref: refs/heads/main;rm$IFS-rf\tHEAD\nfedcba9876543210\tHEAD";
      return null;
    };
    const notice = await computeUpdateNotice("/home/dev/mulmoterminal", "0.7.0", { runGit: git, fetchLatest: async () => null });
    expect(notice).toBe("Update available: 0123456 → origin  ·  run: git pull");
  });

  it("is silent on the git path when the checkout is dirty", async () => {
    const git = async (args: string[]): Promise<string | null> => {
      if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") return "true";
      if (args[0] === "status") return " M src/app.ts"; // tracked change => dirty
      return "whatever";
    };
    expect(await computeUpdateNotice("/home/dev/mulmoterminal", "0.7.0", { runGit: git, fetchLatest: async () => null })).toBeNull();
  });
});
