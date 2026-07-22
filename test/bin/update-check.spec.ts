import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isNewerVersion,
  fetchLatestVersion,
  isUpdateCheckDisabled,
  hasNodeModulesSegment,
  classifyInstall,
  parseLsRemoteHead,
  npmUpdateNotice,
  gitUpdateNotice,
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

  it("names the local short sha and git pull when behind and clean", () => {
    expect(gitUpdateNotice(behind)).toBe("Update available: short12 → origin  ·  run: git pull");
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
