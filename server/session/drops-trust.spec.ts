// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { withFolderTrusted } from "../agents/claude/own-folder-trust";

// The drops root and each login's config are this spec's own, so nothing here touches the machine's.
const { scratch, accounts } = vi.hoisted(() => ({ scratch: { dir: "" }, accounts: new Map<string, string>() }));
vi.mock("./session-drops.js", () => ({
  get DROPS_ROOT() {
    return path.join(scratch.dir, "link-to-tmp", "mulmoterminal-drops");
  },
}));
vi.mock("./session-home.js", () => ({
  accountSpawnEnv: (_agent: string, sessionId: string): Record<string, string> => {
    const home = accounts.get(sessionId);
    return home === undefined ? {} : { CLAUDE_CONFIG_DIR: home };
  },
}));

const { dropsRootTrustKey, markDropsRootTrusted } = await import("./drops-trust");

const loginDir = (name: string): string => {
  const dir = path.join(scratch.dir, name);
  mkdirSync(dir);
  writeFileSync(path.join(dir, ".claude.json"), "{}");
  return dir;
};
const trustedIn = (dir: string, key: string): boolean => withFolderTrusted(readFileSync(path.join(dir, ".claude.json"), "utf8"), key).outcome === "trusted";

describe("markDropsRootTrusted (#3313)", () => {
  let realRoot = "";
  beforeEach(() => {
    scratch.dir = mkdtempSync(path.join(tmpdir(), "mt-drops-trust-"));
    // The root is reached through a link, as os.tmpdir() is on macOS (/var -> /private/var): the
    // entry has to name the real path, because that is the spelling Claude Code looks up. `.native`,
    // as Claude Code resolves it: on Windows only that expands a short name like RUNNER~1.
    const real = path.join(scratch.dir, "real-tmp");
    mkdirSync(path.join(real, "mulmoterminal-drops"), { recursive: true });
    // A junction on Windows: it needs no privilege, where a directory symlink does.
    symlinkSync(real, path.join(scratch.dir, "link-to-tmp"), "junction");
    realRoot = realpathSync.native(path.join(scratch.dir, "link-to-tmp", "mulmoterminal-drops"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    accounts.clear();
    rmSync(scratch.dir, { recursive: true, force: true });
  });

  it("marks the root's real path trusted in the default login's config for an unbound cell", () => {
    const defaultLogin = loginDir("default");
    vi.stubEnv("CLAUDE_CONFIG_DIR", defaultLogin);

    markDropsRootTrusted("11111111-1111-4111-8111-111111111111");

    expect(trustedIn(defaultLogin, realRoot)).toBe(true);
  });

  it("marks it in the account's own config for a cell bound to an account, not the default's", () => {
    const defaultLogin = loginDir("default");
    const account = loginDir("account");
    vi.stubEnv("CLAUDE_CONFIG_DIR", defaultLogin);
    accounts.set("22222222-2222-4222-8222-222222222222", account);

    markDropsRootTrusted("22222222-2222-4222-8222-222222222222");

    expect(trustedIn(account, realRoot)).toBe(true);
    expect(readFileSync(path.join(defaultLogin, ".claude.json"), "utf8")).toBe("{}");
  });

  it("creates no config for a login that has never run claude", () => {
    const empty = path.join(scratch.dir, "never-ran");
    mkdirSync(empty);
    vi.stubEnv("CLAUDE_CONFIG_DIR", empty);

    markDropsRootTrusted("33333333-3333-4333-8333-333333333333");

    expect(existsSync(path.join(empty, ".claude.json"))).toBe(false);
  });

  // A root swapped for a link after ensureDropsDir checked it must not get its TARGET trusted.
  it("names the root where it belongs, never where a link in its place points", () => {
    const elsewhere = path.join(scratch.dir, "somebody-elses");
    mkdirSync(elsewhere);
    const linkedRoot = path.join(scratch.dir, "real-tmp", "linked-drops");
    symlinkSync(elsewhere, linkedRoot, "junction");

    const key = dropsRootTrustKey(path.join(scratch.dir, "link-to-tmp", "linked-drops"));

    expect(key).toBe(path.join(realpathSync.native(path.join(scratch.dir, "real-tmp")), "linked-drops"));
    expect(key).not.toBe(realpathSync.native(elsewhere));
  });
});
