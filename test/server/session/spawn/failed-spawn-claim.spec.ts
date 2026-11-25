// @vitest-environment node
//
// A spawn that throws must not leave its all-tools claim behind (#2848).
//
// claude, codex and copilot record the claim BEFORE the pty starts (#1338: a group url that
// connects first has to know already to stand down). So the claim is on record when ptySpawn
// throws — and only the spawn that made it can take it back. A tmux reattach made no claim: the
// process it would have picked up is still running with the url it was given, so its record stays.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { makeTempDir } from "../../../support/tempDir";
import type { SpawnDeps } from "../../../../server/session/spawn/spawn-deps.js";

// The registry derives MULMOTERMINAL_HOME from the home directory at import time and persists the
// claim log, so HOME is pointed somewhere disposable before anything imports it.
const HOME = makeTempDir("mt-failed-spawn-claim-");
const REAL_HOME = process.env.HOME;
process.env.HOME = HOME;

const pty = vi.hoisted(() => ({ fails: false, reattaching: false }));
const SPAWN_FAILURE = "tmux: command not found";

vi.mock("../../../../server/session/pty/pty-spawn.js", () => ({
  ptySpawn: () => {
    if (pty.fails) throw new Error(SPAWN_FAILURE);
    return { term: { pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() }, tmux: true, reattached: pty.reattaching };
  },
  ptyWouldReattach: () => pty.reattaching,
}));
// `claude --help` and the copilot hooks file would otherwise reach a real binary and a real home.
vi.mock("../../../../server/agents/claude/claude-help-probe.js", () => ({ refuseUnsupportedPermissionMode: vi.fn() }));
vi.mock("../../../../server/agents/copilot/copilot-hooks-file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/agents/copilot/copilot-hooks-file.js")>()),
  syncCopilotHooksFile: vi.fn(),
}));
vi.mock("../../../../server/session/session-reads.js", () => ({ sessionExistsOnDisk: () => false }));

const { hasAllGuiTools, markAllToolsSession, ptys } = await import("../../../../server/session/registry.js");
const { createClaudeSpawner } = await import("../../../../server/session/spawn/agents/spawn-claude.js");
const { whenSessionStatePersisted } = await import("../../../../server/session/reaping/persist-drain.js");
const { createCodexSpawner } = await import("../../../../server/session/spawn/agents/spawn-codex.js");
const { createCopilotSpawner } = await import("../../../../server/session/spawn/agents/spawn-copilot.js");

afterAll(async () => {
  await whenSessionStatePersisted();
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

const deps: SpawnDeps = {
  claudeBin: "claude",
  codexBin: "codex",
  codexModel: null,
  antigravityBin: "agy",
  antigravityModel: null,
  grokBin: "grok",
  grokModel: null,
  museBin: "muse",
  museModel: null,
  copilotBin: "copilot",
  copilotModel: null,
  cursorBin: "cursor-agent",
  cursorModel: null,
  permissionMode: "default",
  guiMcpTools: "mcp__mt",
  gridMcpTools: "mcp__mulmoterminal-render__presentHtml",
  outputBufferLimit: 1000,
  hookSettingsJson: () => "{}",
  mcpConfigJson: () => "{}",
  reap: vi.fn(),
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  uiPort: "3000",
  publishSessionCreated: vi.fn(),
  publishActivity: vi.fn(),
  publishPromptSubmitted: vi.fn(),
};

// attachGuiMcp: every one of these carries the whole GUI MCP, so each spawn claims.
const spawners: Record<string, (id: string) => unknown> = {
  claude: (id) => createClaudeSpawner(deps).spawnClaudePty(id, null, null, { cwd: HOME, attachGuiMcp: true }),
  codex: (id) => createCodexSpawner(deps).spawnCodexPty(id, null, null, HOME, true),
  copilot: (id) => createCopilotSpawner(deps).spawnCopilotPty(id, null, null, HOME, true),
};

beforeEach(() => {
  ptys.clear();
  pty.fails = false;
  pty.reattaching = false;
});

describe.each(Object.keys(spawners))("a %s spawn and its all-tools claim", (agent) => {
  const spawn = spawners[agent];

  it("releases the claim when a fresh spawn throws, and still throws", () => {
    const id = randomUUID();
    pty.fails = true;
    expect(() => spawn(id)).toThrow(SPAWN_FAILURE);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  it("keeps the claim of the process a reattach would have picked up, even when the spawn throws", () => {
    const id = randomUUID();
    markAllToolsSession(id);
    pty.fails = true;
    pty.reattaching = true;
    expect(() => spawn(id)).toThrow(SPAWN_FAILURE);
    expect(hasAllGuiTools(id)).toBe(true);
  });

  it("keeps the claim of a fresh spawn that started", () => {
    const id = randomUUID();
    spawn(id);
    expect(hasAllGuiTools(id)).toBe(true);
  });
});
