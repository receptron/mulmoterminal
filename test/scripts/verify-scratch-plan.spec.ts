// @vitest-environment node
import path from "node:path";
import { describe, it, expect } from "vitest";
import { homeScopeSuffix } from "../../server/config/home-scope.js";
import { isClientBuildStale, scratchSocketPath, socketStopDecision, tmuxSocketDirFor, type ScratchPaths } from "../../scripts/verify-scratch-plan.js";

const ACCOUNT_HOME = "/Users/someone";
const SOCKET_DIR = "/private/tmp/tmux-501";
const paths: ScratchPaths = { scratchHome: "/private/tmp/verify-home", accountHome: ACCOUNT_HOME, tmuxSocketDir: SOCKET_DIR };
const scratchSocket = path.join(SOCKET_DIR, `mulmoterminal${homeScopeSuffix(paths.scratchHome, ACCOUNT_HOME)}`);

describe("scratchSocketPath", () => {
  it("is the name the server derives for that HOME, in the tmux socket directory", () => {
    expect(scratchSocketPath(paths)).toBe(scratchSocket);
    expect(path.basename(scratchSocket)).toMatch(/^mulmoterminal-[0-9a-f]{16}$/);
  });

  it("is null for the account's own home, whose server is the live one", () => {
    expect(scratchSocketPath({ ...paths, scratchHome: ACCOUNT_HOME })).toBeNull();
    expect(scratchSocketPath({ ...paths, scratchHome: `${ACCOUNT_HOME}/` })).toBeNull();
  });

  it("differs between two scratch homes", () => {
    expect(scratchSocketPath({ ...paths, scratchHome: "/private/tmp/other-home" })).not.toBe(scratchSocket);
  });
});

describe("socketStopDecision", () => {
  it("allows exactly the computed scratch socket", () => {
    expect(socketStopDecision(scratchSocket, paths)).toEqual({ ok: true });
  });

  it.each([
    ["the live server's socket", path.join(SOCKET_DIR, "mulmoterminal")],
    ["the default tmux socket", path.join(SOCKET_DIR, "default")],
    ["another scratch home's socket", scratchSocketPath({ ...paths, scratchHome: "/private/tmp/other-home" }) ?? ""],
    ["the right name in another directory", path.join("/tmp/elsewhere", path.basename(scratchSocket))],
    ["a bare -L name", path.basename(scratchSocket)],
    ["an empty path", ""],
  ])("refuses %s", (_label, socketPath) => {
    expect(socketStopDecision(socketPath, paths).ok).toBe(false);
  });

  it("refuses everything when the scratch HOME is the account's own", () => {
    const live = { ...paths, scratchHome: ACCOUNT_HOME };
    expect(socketStopDecision(path.join(SOCKET_DIR, "mulmoterminal"), live).ok).toBe(false);
  });
});

describe("tmuxSocketDirFor", () => {
  it("uses TMUX_TMPDIR when set, else /tmp", () => {
    expect(tmuxSocketDirFor("/var/run/x", 501)).toBe("/var/run/x/tmux-501");
    expect(tmuxSocketDirFor(undefined, 501)).toBe("/tmp/tmux-501");
    expect(tmuxSocketDirFor("", 501)).toBe("/tmp/tmux-501");
  });
});

describe("isClientBuildStale", () => {
  it("is stale when there is no build, or the source is newer", () => {
    expect(isClientBuildStale(null, 1)).toBe(true);
    expect(isClientBuildStale(100, 200)).toBe(true);
  });

  it("is fresh when the build is as new as the source or newer", () => {
    expect(isClientBuildStale(200, 200)).toBe(false);
    expect(isClientBuildStale(300, 200)).toBe(false);
  });
});
