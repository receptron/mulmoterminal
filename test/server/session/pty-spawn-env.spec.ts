// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

// node-pty is a native module and spawning is the whole point of the file under test, so
// the pty itself is mocked: what matters here is the ENVIRONMENT handed to it.
const spawn = vi.fn(() => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn() }));
vi.mock("node-pty", () => ({ default: { spawn: (...args: unknown[]) => spawn(...(args as [])) } }));
const scrub = vi.fn();
vi.mock("../../../server/infra/tmux.js", () => ({
  tmuxAvailable: () => tmuxOn,
  tmuxNewSessionArgs: (id: string, file: string, args: string[]) => ["new-session", id, file, ...args],
  tmuxScrubEnvNames: (names: readonly string[]) => scrub(names),
}));

let tmuxOn = false;

const { spawnPty, ptySpawn } = await import("../../../server/session/pty-spawn.js");

const envOf = (call: number = 0): NodeJS.ProcessEnv => (spawn.mock.calls[call] as unknown as [string, string[], { env: NodeJS.ProcessEnv }])[2].env;

beforeEach(() => {
  spawn.mockClear();
  scrub.mockClear();
  tmuxOn = false;
  process.env.ANTHROPIC_API_KEY = "sk-ant-leftover";
  process.env.MT_KEEP_ME = "kept";
});

// A leftover ANTHROPIC_API_KEY silently outranks the auth token that aims a provider
// session at its backend, and the settings `env` block can set a variable but not remove
// one. So the removal has to happen HERE — computing it and not applying it (which is
// exactly what shipped first) leaves the routing broken with no symptom until a request.
describe("spawnPty — the environment it hands the pty", () => {
  it("removes the named variables", () => {
    spawnPty("claude", [], "/tmp", ["ANTHROPIC_API_KEY"]);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("keeps everything else", () => {
    spawnPty("claude", [], "/tmp", ["ANTHROPIC_API_KEY"]);
    expect(envOf().MT_KEEP_ME).toBe("kept");
  });

  it("leaves the environment alone when nothing is named", () => {
    spawnPty("claude", [], "/tmp");
    expect(envOf().ANTHROPIC_API_KEY).toBe("sk-ant-leftover");
  });
});

// The tmux pane inherits the tmux SERVER's environment rather than this one, so the scrub
// there is what actually protects it — but the non-tmux path has only this.
describe("ptySpawn — carries the removal down both paths", () => {
  it("applies it on the direct spawn", () => {
    ptySpawn("s1", "claude", [], "/tmp", false, ["ANTHROPIC_API_KEY"]);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("applies it on the tmux spawn too", () => {
    tmuxOn = true;
    const result = ptySpawn("s1", "claude", [], "/tmp", true, ["ANTHROPIC_API_KEY"]);
    expect(result.tmux).toBe(true);
    expect(envOf()).not.toHaveProperty("ANTHROPIC_API_KEY");
  });
});

// Stripping our own copy is not enough: a pane inherits the tmux SERVER's environment,
// and a server created by an earlier non-provider session already carries the key. The
// scrub in ensureConf only covers a server that predates this process.
describe("ptySpawn — the tmux server's own environment", () => {
  it("scrubs the names from the running server before a provider spawn", () => {
    tmuxOn = true;
    ptySpawn("s1", "claude", [], "/tmp", true, ["ANTHROPIC_API_KEY"]);
    expect(scrub).toHaveBeenCalledWith(["ANTHROPIC_API_KEY"]);
  });

  it("leaves the server alone for an ordinary session", () => {
    tmuxOn = true;
    ptySpawn("s1", "claude", [], "/tmp", true);
    expect(scrub).not.toHaveBeenCalled();
  });
});
