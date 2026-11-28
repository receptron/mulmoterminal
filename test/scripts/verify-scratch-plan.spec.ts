// @vitest-environment node
import path from "node:path";
import { describe, it, expect } from "vitest";
import { homeScopeSuffix } from "../../server/config/home-scope.js";
import {
  groupToSignal,
  isClientBuildStale,
  isSupportedPlatform,
  launcherArgs,
  launcherMatches,
  scratchServerPid,
  scratchSocketPath,
  socketStopDecision,
  tmuxCleanupDecision,
  tmuxSocketDirFor,
  type LauncherRecord,
  type ProcessFacts,
  type ScratchPaths,
} from "../../scripts/verify-scratch-plan.js";

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
  it("is tmux-<uid> under the real temp directory", () => {
    expect(tmuxSocketDirFor("/private/tmp", 501)).toBe("/private/tmp/tmux-501");
  });
});

describe("launcherMatches", () => {
  const CHECKOUT = "/work/mulmoterminal";
  const HOME = "/private/tmp/verify-home";
  const identity = { logPath: `${HOME}/server.log`, launcherScript: path.join(CHECKOUT, "bin", "mulmoterminal.js"), launcherTitle: "mulmoterminal :47411" };
  const command = ["/usr/bin/node", ...launcherArgs(CHECKOUT, 47411, `${HOME}/work`)].join(" ");
  const recorded: LauncherRecord = { pid: 900, startedAt: "Sat Nov 28 09:02:45 2026", command };
  const observed: ProcessFacts = { pid: 900, pgid: 900, startedAt: recorded.startedAt, command, stdoutPath: `${HOME}/server.log` };

  it("matches the recorded launcher, before and after it renames itself", () => {
    expect(launcherMatches(recorded, observed, identity)).toBe(true);
    expect(launcherMatches(recorded, { ...observed, command: "mulmoterminal :47411" }, identity)).toBe(true);
  });

  it.each([
    ["no such process", null],
    ["a reused pid, started later", { ...observed, startedAt: "Sat Nov 28 10:00:00 2026" }],
    ["a different command at that pid", { ...observed, command: "/usr/bin/vim notes.md" }],
    ["this checkout's launcher on another port", { ...observed, command: ["/usr/bin/node", ...launcherArgs(CHECKOUT, 47412, `${HOME}/work`)].join(" ") }],
    ["a launcher titled for another port", { ...observed, command: "mulmoterminal :47412" }],
    ["another pid", { ...observed, pid: 901 }],
    ["a process writing elsewhere (the live launcher writes to its terminal)", { ...observed, stdoutPath: "/dev/ttys003" }],
    ["a process whose stdout cannot be read", { ...observed, stdoutPath: null }],
  ])("refuses %s", (_label, facts) => {
    expect(launcherMatches(recorded, facts, identity)).toBe(false);
  });

  it("refuses the live server's launcher, even from a record forged to name it", () => {
    const live: ProcessFacts = { pid: 77, pgid: 77, startedAt: "Fri Nov 27 08:00:00 2026", command: "mulmoterminal :34567", stdoutPath: "/dev/ttys003" };
    const forged: LauncherRecord = { pid: 77, startedAt: live.startedAt, command };
    expect(launcherMatches(forged, live, { ...identity, launcherTitle: "mulmoterminal :34567" })).toBe(false);
  });

  it("refuses a record naming another checkout's launcher", () => {
    const elsewhere = ["/usr/bin/node", ...launcherArgs("/other/checkout", 47411, `${HOME}/work`)].join(" ");
    expect(launcherMatches({ ...recorded, command: elsewhere }, { ...observed, command: elsewhere }, identity)).toBe(false);
  });
});

describe("scratchServerPid", () => {
  const HOME = "/private/tmp/verify-home";
  const facts = new Map<number, ProcessFacts>([
    [1001, { pid: 1001, pgid: 900, startedAt: "t", command: "mulmoterminal :47411", stdoutPath: `${HOME}/server.log` }],
    [1002, { pid: 1002, pgid: 777, startedAt: "t", command: "mulmoterminal :47411", stdoutPath: `${HOME}/server.log` }],
    [1004, { pid: 1004, pgid: 900, startedAt: "t", command: "mulmoterminal :47411", stdoutPath: "/private/tmp/other-home/server.log" }],
  ]);
  const factsOf = (pid: number): ProcessFacts | null => facts.get(pid) ?? null;

  it("is the entry on the recorded port whose process is in the launcher's group, writing to the scratch log", () => {
    expect(scratchServerPid([{ pid: 1001, port: 47411 }], 47411, factsOf, 900, `${HOME}/server.log`)).toBe(1001);
  });

  it.each([
    ["another port", [{ pid: 1001, port: 47412 }]],
    ["another process group", [{ pid: 1002, port: 47411 }]],
    ["a process writing to another scratch log", [{ pid: 1004, port: 47411 }]],
    ["a pid that is gone", [{ pid: 1003, port: 47411 }]],
    ["no port recorded", [{ pid: 1001, port: null }]],
    ["no entries", []],
  ])("is null for %s", (_label, entries) => {
    expect(scratchServerPid(entries, 47411, factsOf, 900, `${HOME}/server.log`)).toBeNull();
  });
});

describe("groupToSignal", () => {
  it("is the launcher's group when the launcher or its server is identified", () => {
    expect(groupToSignal(true, null, 900)).toBe(900);
    expect(groupToSignal(false, 1001, 900)).toBe(900);
  });

  it("is null when neither is identified", () => {
    expect(groupToSignal(false, null, 900)).toBeNull();
  });
});

describe("tmuxCleanupDecision", () => {
  it("stops tmux only once nothing answers", () => {
    expect(tmuxCleanupDecision(false)).toEqual({ ok: true });
    expect(tmuxCleanupDecision(true).ok).toBe(false);
  });
});

describe("isSupportedPlatform", () => {
  it("accepts macOS and Linux and refuses the rest", () => {
    expect(isSupportedPlatform("darwin")).toBe(true);
    expect(isSupportedPlatform("linux")).toBe(true);
    expect(isSupportedPlatform("win32")).toBe(false);
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
