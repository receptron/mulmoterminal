// @vitest-environment node
//
// codex and copilot limited to some GUI tool groups (#3033). The MCP routes enforce the record
// whatever the agent; what is pinned here is that each spawner records it, reads it back on every
// later spawn of the id, hands exactly those groups, and never claims the all-tools url — plus
// codex's own way back in, a resume under the rollout id.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { makeTempDir } from "../../../support/tempDir";
import type { SpawnDeps } from "../../../../server/session/spawn/spawn-deps.js";
import type { ToolGroup } from "../../../../common/toolGroups.js";

// The registry derives MULMOTERMINAL_HOME from the home directory at import time and persists its
// logs there, so HOME is pointed somewhere disposable before anything imports it.
const HOME = makeTempDir("mt-gui-restriction-agents-");
const REAL_HOME = process.env.HOME;
process.env.HOME = HOME;

const spawned = vi.hoisted(() => ({ argv: [] as string[][] }));

vi.mock("../../../../server/session/pty/pty-spawn.js", () => ({
  ptySpawn: (_id: string, _bin: string, args: string[]) => {
    spawned.argv.push(args);
    return { term: { pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() }, tmux: true, reattached: false };
  },
  ptyWouldReattach: () => false,
}));
vi.mock("../../../../server/agents/copilot/copilot-hooks-file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/agents/copilot/copilot-hooks-file.js")>()),
  syncCopilotHooksFile: vi.fn(),
}));
// The fresh codex branch polls codex's real sessions root for a rollout to appear.
vi.mock("../../../../server/agents/codex/codex-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../server/agents/codex/codex-session.js")>()),
  snapshotSessions: () => new Set<string>(),
  watchForCodexSession: () => new Promise(() => {}),
}));

const { hasAllGuiTools, guiGroupRestriction, rememberGuiGroupRestriction, rememberCodexRollout, ptys } = await import("../../../../server/session/registry.js");
const { whenSessionStatePersisted } = await import("../../../../server/session/reaping/persist-drain.js");
const { createCodexSpawner } = await import("../../../../server/session/spawn/agents/spawn-codex.js");
const { createCopilotSpawner } = await import("../../../../server/session/spawn/agents/spawn-copilot.js");

afterAll(async () => {
  await whenSessionStatePersisted();
  if (REAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = REAL_HOME;
  rmSync(HOME, { recursive: true, force: true });
});

const deps = {
  codexBin: "codex",
  codexModel: null,
  copilotBin: "copilot",
  copilotModel: null,
  outputBufferLimit: 1000,
  mcpConfigJson: (sessionId: string) => JSON.stringify({ mcpServers: { mt: { type: "http", url: `http://127.0.0.1/api/mcp/${sessionId}` } } }),
  reap: vi.fn(),
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  uiPort: "3000",
  publishSessionCreated: vi.fn(),
  publishActivity: vi.fn(),
  publishPromptSubmitted: vi.fn(),
} as unknown as SpawnDeps;

interface Spawn {
  id: string;
  attachGuiMcp?: boolean;
  mcpGroups?: readonly ToolGroup[];
  guiGroups?: readonly ToolGroup[];
  resumeId?: string | null;
}

const spawners = {
  codex: ({ id, attachGuiMcp = true, mcpGroups = [], guiGroups, resumeId = null }: Spawn) =>
    createCodexSpawner(deps).spawnCodexPty(id, null, resumeId, HOME, attachGuiMcp, { mcpGroups, guiGroups }),
  copilot: ({ id, attachGuiMcp = true, mcpGroups = [], guiGroups, resumeId = null }: Spawn) =>
    createCopilotSpawner(deps).spawnCopilotPty(id, null, resumeId, HOME, attachGuiMcp, { mcpGroups, guiGroups }),
};

// The GUI MCP urls the last spawn was handed, as `<group>` or `*` for the all-tools url.
function handedUrls(sessionId: string): string[] {
  const argv = spawned.argv.at(-1)?.join(" ") ?? "";
  const handed = argv
    .split("/api/mcp/")
    .slice(1)
    .map((tail) => tail.split(/["\s]/)[0].split("/"))
    .filter((segments) => segments.at(-1) === sessionId)
    .map((segments) => (segments.length === 1 ? "*" : segments[0]));
  return [...new Set(handed)];
}

beforeEach(() => {
  ptys.clear();
  spawned.argv.length = 0;
});

describe.each(Object.keys(spawners) as (keyof typeof spawners)[])("%s limited to some GUI tool groups", (agent) => {
  const spawn = spawners[agent];

  it("hands exactly its groups where it would otherwise carry every tool, and makes no claim", () => {
    const id = randomUUID();
    spawn({ id, guiGroups: ["render", "media"] });
    expect(handedUrls(id)).toEqual(["render", "media"]);
    expect(hasAllGuiTools(id)).toBe(false);
    expect(guiGroupRestriction(id)).toEqual(["render", "media"]);
  });

  it("hands no GUI MCP at all for an empty list", () => {
    const id = randomUUID();
    spawn({ id, guiGroups: [] });
    expect(handedUrls(id)).toEqual([]);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  it("stays limited when the id is spawned again without the field, whatever the directory registered", () => {
    const id = randomUUID();
    spawn({ id, guiGroups: ["data"] });
    ptys.clear();
    spawn({ id, attachGuiMcp: false, mcpGroups: ["render", "data"] });
    expect(handedUrls(id)).toEqual(["data"]);
    ptys.clear();
    spawn({ id, attachGuiMcp: true });
    expect(handedUrls(id)).toEqual(["data"]);
    expect(hasAllGuiTools(id)).toBe(false);
  });

  it("leaves an unrestricted session exactly as before", () => {
    const id = randomUUID();
    spawn({ id });
    expect(handedUrls(id)).toEqual(["*"]);
    expect(hasAllGuiTools(id)).toBe(true);
    const cell = randomUUID();
    spawn({ id: cell, attachGuiMcp: false, mcpGroups: ["render", "external"] });
    expect(handedUrls(cell)).toEqual(["render", "external"]);
  });
});

// The launcher lists codex rows by codex's own rollout id, so an ended worker can come back under a
// key its restriction was never recorded for.
describe("codex resumed under the rollout id", () => {
  it("inherits the restriction of the session that wrote the rollout", () => {
    const worker = randomUUID();
    const rollout = randomUUID();
    rememberGuiGroupRestriction(worker, ["render"]);
    rememberCodexRollout(worker, rollout, HOME);
    spawners.codex({ id: rollout, resumeId: rollout });
    expect(handedUrls(rollout)).toEqual(["render"]);
    expect(guiGroupRestriction(rollout)).toEqual(["render"]);
    expect(hasAllGuiTools(rollout)).toBe(false);
  });

  it("carries every tool when no session holding the rollout was limited", () => {
    const worker = randomUUID();
    const rollout = randomUUID();
    rememberCodexRollout(worker, rollout, HOME);
    spawners.codex({ id: rollout, resumeId: rollout });
    expect(handedUrls(rollout)).toEqual(["*"]);
    expect(guiGroupRestriction(rollout)).toBeNull();
  });
});
