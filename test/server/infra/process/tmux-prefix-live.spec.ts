// @vitest-environment node
//
// #2981. setTmuxPrefix writes the conf a fresh tmux server will source AND runs the same commands on a
// server that is already up. tmux itself is replaced by a recorder; test/common/tmuxPrefix.spec.ts has
// the commands, and a real tmux was driven by hand for what they do.
import { describe, it, expect, vi, afterAll, beforeEach } from "vitest";
import { readFileSync, rmSync } from "node:fs";

const scratch = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "mt-tmuxlive-"));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return { home, conf: join(home, ".mulmoterminal", "tmux.conf") };
});

const calls: string[][] = [];
vi.mock("../../../../server/infra/process/spawnCapture.js", () => ({
  spawnCapture: (_bin: string, args: string[]) => {
    calls.push(args);
    return { status: 0, stdout: "", stderr: "" };
  },
  spawnCaptureAsync: async () => ({ status: 0, stdout: "", stderr: "" }),
}));

const { tmuxAvailable, setTmuxPrefix } = await import("../../../../server/infra/process/tmux.js");

afterAll(() => rmSync(scratch.home, { recursive: true, force: true }));
beforeEach(() => calls.splice(0));

const liveCommands = (): string[] =>
  calls
    .filter((args) => args[2] === "set" || args[2] === "unbind-key" || args[2] === "bind-key")
    .map((args) => args.slice(2).join(" "))
    .filter((command) => /prefix|unbind-key C-|bind-key C-.* send-prefix/u.test(command));
const confPrefixLines = (): string[] =>
  readFileSync(scratch.conf, "utf8")
    .split("\n")
    .filter((line) => /prefix|unbind-key C-b/u.test(line) && !line.startsWith("bind -T"));

describe("setTmuxPrefix", () => {
  it("writes the default into the conf the first answer creates", () => {
    expect(tmuxAvailable()).toBe(true);
    expect(confPrefixLines()).toEqual(["set -g prefix None", "unbind-key C-b"]);
  });

  it("does nothing for the prefix it already holds", () => {
    setTmuxPrefix("none");
    expect(calls).toEqual([]);
  });

  it("moves to a custom key: conf rewritten, running server told", () => {
    setTmuxPrefix("C-]");
    expect(confPrefixLines()).toEqual(["set -g prefix C-]", "unbind-key C-b", "bind-key C-] send-prefix"]);
    expect(liveCommands()).toContain("set -g prefix C-]");
  });

  it("unbinds the old custom key when it moves on, and restores C-b", () => {
    setTmuxPrefix("C-b");
    expect(liveCommands()).toEqual(expect.arrayContaining(["unbind-key C-]", "set -g prefix C-b", "bind-key C-b send-prefix"]));
    expect(confPrefixLines()).toEqual(["set -g prefix C-b", "bind-key C-b send-prefix"]);
  });

  it("does not unbind C-b or none as an old key", () => {
    setTmuxPrefix("none");
    expect(liveCommands()).not.toContain("unbind-key none");
    expect(liveCommands().filter((command) => command === "unbind-key C-b")).toHaveLength(1);
  });
});
