// @vitest-environment node
//
// A psmux server outlives this process, so one started before Volta's marker was kept off its client
// still hands it to every new pane. The startup scrub has to take it from there too — and only there.
// tmux itself is replaced by a recorder.
import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const scratch = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "mt-psmuxscrub-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return { home };
});

const calls: string[][] = [];
let versionStdout = "";
let asyncListFailures = 0;
vi.mock("../../../../server/infra/process/spawnCapture.js", () => ({
  spawnCapture: (_bin: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "-V") return { status: 0, stdout: versionStdout, stderr: "" };
    if (args[2] === "list-sessions") return { status: 0, stdout: "mt-abc\n", stderr: "" };
    if (args[2] === "show-environment") return { status: 0, stdout: "_VOLTA_TOOL_RECURSION=1\nHOME=/h\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  },
  spawnCaptureAsync: async (_bin: string, args: string[]) => {
    calls.push(args);
    if (args[2] === "list-sessions" && asyncListFailures > 0) {
      asyncListFailures -= 1;
      return { status: null, stdout: "", stderr: "timed out" };
    }
    if (args[2] === "list-sessions") return { status: 0, stdout: "mt-abc\nmt-def\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  },
}));

afterAll(() => rmSync(scratch.home, { recursive: true, force: true }));
beforeEach(() => {
  calls.splice(0);
  asyncListFailures = 0;
  vi.resetModules();
});

const startWith = async (stdout: string): Promise<void> => {
  versionStdout = stdout;
  const { tmuxAvailable } = await import("../../../../server/infra/process/tmux.js");
  expect(tmuxAvailable()).toBe(true);
};
const removed = (): string[] => calls.filter((args) => args[2] === "set-environment" && args[4] === "-r").map((args) => args[5] ?? "");

describe("the startup scrub of a running server", () => {
  it("takes Volta's marker from a running psmux", async () => {
    await startWith("tmux 3.4\npsmux 3.4.0 (abc)\n");
    expect(removed()).toContain("_VOLTA_TOOL_RECURSION");
  });

  // Not only psmux: a real tmux server keeps the client's environment for life too (#3233).
  it("takes it from a running real tmux as well", async () => {
    await startWith("tmux 3.8\n");
    expect(removed()).toContain("_VOLTA_TOOL_RECURSION");
  });
});

// Every cell's `new-session` carries `-e`, which skips psmux's warm pool, so its spare shells are
// never claimed — they only cost memory, and every client resize restarts them.
describe("psmux's warm pool", () => {
  const conf = (): string => readFileSync(join(scratch.home, ".mulmoterminal", "tmux.conf"), "utf8");
  const liveWarm = (): string[][] => calls.filter((args) => args[2] === "set-option" && args.includes("warm")).map((args) => args.slice(2));

  it("is turned off in the conf and on each running psmux session", async () => {
    await startWith("tmux 3.4\npsmux 3.4.0 (abc)\n");
    expect(conf()).toContain("set -g warm off");
    await vi.waitFor(() => expect(liveWarm()).toHaveLength(2));
    expect(liveWarm()).toEqual([
      ["set-option", "-t", "mt-abc", "-g", "warm", "off"],
      ["set-option", "-t", "mt-def", "-g", "warm", "off"],
    ]);
  });

  it("is left alone on a psmux too old to know the option", async () => {
    await startWith("tmux 3.3\npsmux 3.3.0 (abc)\n");
    expect(conf()).not.toContain("warm");
    expect(liveWarm()).toEqual([]);
  });

  it("is sent again on the next conf write, so a failed attempt is not final", async () => {
    asyncListFailures = 1;
    await startWith("tmux 3.4\npsmux 3.4.0 (abc)\n");
    await vi.waitFor(() => expect(asyncListFailures).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(liveWarm()).toEqual([]);
    const { setTmuxPrefix } = await import("../../../../server/infra/process/tmux.js");
    setTmuxPrefix("C-a");
    await vi.waitFor(() => expect(liveWarm()).toHaveLength(2));
  });

  it("is never asked of a real tmux", async () => {
    await startWith("tmux 3.8\n");
    expect(conf()).not.toContain("warm");
    expect(liveWarm()).toEqual([]);
  });
});

// psmux has no `terminal-features`: 3.4.0 rejects the option and prints the rejection into the first
// pane of every new server (#3204), and it forwards OSC 8 to its client without being told to. So
// the declaration is neither written for it nor sent to a server of its that is already running.
describe("the terminal-features declaration", () => {
  const conf = (): string => readFileSync(join(scratch.home, ".mulmoterminal", "tmux.conf"), "utf8");
  const liveFeatureCommands = (): string[][] => calls.filter((args) => args.includes("terminal-features")).map((args) => args.slice(2));

  // The conf opens with the shared block, byte for byte; psmux's own options and the prefix
  // commands follow it. Compared whole rather than by a few lines, so a second line going missing
  // (or the filter taking the wrong one) cannot pass.
  const sharedBlock = async (): Promise<string[]> => {
    const { TMUX_CONF_LINES } = await import("../../../../server/infra/process/tmux.js");
    return conf().split("\n").slice(0, TMUX_CONF_LINES.length);
  };

  it("is left out of psmux's conf and never sent to a running psmux", async () => {
    await startWith("tmux 3.4\npsmux 3.4.0 (abc)\n");
    const { TMUX_CONF_LINES, tmuxConfLinesFor } = await import("../../../../server/infra/process/tmux.js");
    expect(conf()).not.toContain("terminal-features");
    expect((await sharedBlock()).slice(0, TMUX_CONF_LINES.length - 1)).toEqual(tmuxConfLinesFor(true));
    expect(liveFeatureCommands()).toEqual([]);
  });

  it("stays in a real tmux's conf, and is set on a running real tmux that lacks it", async () => {
    await startWith("tmux 3.8\n");
    const { TMUX_CONF_LINES } = await import("../../../../server/infra/process/tmux.js");
    expect(await sharedBlock()).toEqual(TMUX_CONF_LINES);
    expect(liveFeatureCommands()).toEqual([
      ["show", "-g", "terminal-features"],
      ["set", "-as", "terminal-features", "*:hyperlinks"],
    ]);
  });
});
