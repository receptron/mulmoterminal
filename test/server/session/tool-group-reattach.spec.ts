// @vitest-environment node
//
// A session's learned tool groups must survive a REATTACH.
//
// spawnClaudePty is both paths: a genuinely new claude, and the one ws-routes comes back through
// after the server restarts while the tmux session (and its claude) kept running. The reset exists
// for the first — a new process reads the user's MCP config now, so what the id learned under an
// older one is stale. On the second nothing is re-read, and an MCP client that connected once will
// not connect again: resetting there drops a capability with no way left to relearn it, and the
// panel then reports "Canvas is not enabled for this session" on a cell that is still drawing.
//
// That is exactly what session-tool-groups.ts persists the log for, and the unconditional reset
// was undoing it on every server restart.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "11111111-2222-4333-8444-555555555555";

let reattaching = false;
let sandboxRuns = false;
const resetSessionToolGroups = vi.fn();

// Hooks so the ORDER of probe / reset / spawn can be asserted, not just their arguments.
let probed = () => {};
let spawned = () => {};

vi.mock("../../../server/session/pty-spawn.js", () => ({
  ptySpawn: () => {
    spawned();
    return { term: fakeTerm(), tmux: true };
  },
  ptyWouldReattach: () => {
    probed();
    return reattaching;
  },
  sandboxWouldRun: () => sandboxRuns,
  spawnSandboxEntry: () => ({ term: fakeTerm(), ws: null, buffer: "", cwd: "/tmp", sandbox: true, active: false, agent: "claude" }),
}));

vi.mock("../../../server/session/registry.js", () => ({
  knownSessions: new Map(),
  launchChoices: new Map(),
  ptys: new Map(),
  resetSessionToolGroups: (id: string) => resetSessionToolGroups(id),
}));

// The transcript check decides --resume; irrelevant here and it would touch the real disk.
vi.mock("../../../server/session/session-reads.js", () => ({ sessionExistsOnDisk: () => false }));

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });

const { createClaudeSpawner } = await import("../../../server/session/spawn-claude.js");

const deps = {
  claudeBin: "claude",
  codexBin: "codex",
  codexModel: null,
  permissionMode: "default",
  guiMcpTools: "mcp__mulmoterminal-gui",
  gridMcpTools: "mcp__mulmoterminal-render__presentHtml",
  outputBufferLimit: 1000,
  hookSettingsJson: () => "{}",
  mcpConfigJson: () => "{}",
  reap: vi.fn(),
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  uiPort: "3000",
  publishSessionCreated: vi.fn(),
};

// The sandbox only runs for a session with a viewer attached (`ws !== null`), so the socket is
// part of what the third case is testing rather than incidental.
const fakeWs = { readyState: 1, send: vi.fn(), close: vi.fn(), on: vi.fn() } as unknown as Parameters<
  ReturnType<typeof createClaudeSpawner>["spawnClaudePty"]
>[2];

const spawn = (options: Record<string, unknown>, ws: typeof fakeWs = null) => createClaudeSpawner(deps).spawnClaudePty(ID, null, ws, options);

beforeEach(() => {
  resetSessionToolGroups.mockReset();
  reattaching = false;
  sandboxRuns = false;
  probed = () => {};
  spawned = () => {};
});

describe("spawnClaudePty and the tool-group reset", () => {
  it("resets when a new claude process is about to start", () => {
    spawn({ cwd: process.cwd(), attachGuiMcp: false });
    expect(resetSessionToolGroups).toHaveBeenCalledWith(ID);
  });

  // The regression: the server restarted, the pty map is empty, but tmux still holds the SAME
  // claude. Nothing re-reads the MCP config, so nothing can be relearned.
  it("does NOT reset when reattaching to a surviving process", () => {
    reattaching = true;
    spawn({ cwd: process.cwd(), attachGuiMcp: false });
    expect(resetSessionToolGroups).not.toHaveBeenCalled();
  });

  // A sandbox spawn starts a fresh container every time — a leftover tmux session for the id
  // says nothing about it.
  it("resets a sandbox spawn even when tmux has the id", () => {
    reattaching = true;
    sandboxRuns = true;
    spawn({ cwd: process.cwd(), attachGuiMcp: true }, fakeWs);
    expect(resetSessionToolGroups).toHaveBeenCalledWith(ID);
  });

  // The probe's answer expires the moment the tmux session ends, so it is taken one statement
  // before the spawn rather than up with the other decisions — the provider resolution, the git
  // probes and the settings file all sit between, and each is time the session can end in.
  it("asks immediately before spawning, not before the rest of the setup", () => {
    const order: string[] = [];
    resetSessionToolGroups.mockImplementation(() => order.push("reset"));
    probed = () => order.push("probe");
    spawned = () => order.push("spawn");
    spawn({ cwd: process.cwd(), attachGuiMcp: false });
    expect(order).toEqual(["probe", "reset", "spawn"]);
  });
});
