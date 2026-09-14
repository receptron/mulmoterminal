// @vitest-environment node
// The cursor WS handler: WHICH directory a reconnect runs in, and — the half that shipped broken —
// whether the socket is treated as the actively-viewed pane.
//
// `?gui=0` is what a GRID cell sends. For the other agents it carries two things: attach the GUI
// MCP, and "this socket is the viewed pane". Cursor has no per-spawn MCP, and the first version of
// this handler therefore dropped the parameter entirely and hard-coded `entry.active = true`. That
// is not cosmetic: `activityHookEffects("Stop", active)` returns the `waiting` flag ONLY when the
// pane is inactive, so every cursor GRID cell finished its turn in silence — no attention dot, no
// sound, which is the feature the agent was added for (Codex round 1 of #2065, P1).
//
// So this drives the real handler and asserts what the SPAWNER and the ADMISSION were handed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

const ptys = new Map<string, unknown>();
const sessionCwd = vi.fn((): string | null => null);
const markDevTerminalSession = vi.fn();
vi.mock("../../../server/session/registry.js", () => ({
  ptys,
  sessionCwd: () => sessionCwd(),
  devTerminalCwdsHydrated: Promise.resolve(),
  antigravityConversations: new Map(),
  antigravityConversationsHydrated: Promise.resolve(),
  museConversations: new Map(),
  museConversationsHydrated: Promise.resolve(),
  codexRollouts: new Map(),
  codexRolloutsHydrated: Promise.resolve(),
  customAgentSessionsHydrated: Promise.resolve(),
  markDevTerminalSession,
  markAttachedSessionPlaced: vi.fn(),
}));

vi.mock("../../../server/infra/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/tmux.js")>()),
  tmuxAvailable: () => false,
  tmuxHasSession: () => false,
}));

// The session exists wherever it is asked about, so the probe's answer cannot be what makes this
// pass or fail — only the DIRECTORY handed on does.
vi.mock("../../../server/agents/cursor-sessions.js", () => ({
  cursorSessionExistsForCwd: () => true,
  cursorSessionExists: () => true,
  listCursorSessionsForCwd: () => [],
}));

const reserveWorktreeEnv = vi.fn(async () => ({}));
vi.mock("../../../server/config/worktree-env.js", () => ({
  ensureWorktreeEnv: (...args: unknown[]) => reserveWorktreeEnv(...(args as [])),
  reservedWorktreeEnv: () => ({}),
}));

vi.mock("../../../server/session/worktree-session-limit.js", () => ({
  claimLaunch: () => ({ release: vi.fn(), contended: false }),
  worktreeOccupancy: () => Promise.resolve({ isWorktree: false, session: null }),
}));

vi.mock("../../../server/infra/gui-mcp-registration.js", () => ({ registeredGuiMcpGroups: vi.fn(async () => []) }));

const { handleCursorConnection } = await import("../../../server/routes/ws-routes.js");

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });
const spawnCursorPty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const deps = { spawnCursorPty, reattachPty: vi.fn(), handleClientFrame: vi.fn(), handleClientClose: vi.fn() } as never;

const fakeWs = () => ({ readyState: 1, OPEN: 1, send: vi.fn(), close: vi.fn(), on: vi.fn(), off: vi.fn(), once: vi.fn() }) as unknown as WebSocket;

const ID = "3a7c1e90-2b44-4c8e-9d10-5f6a7b8c9d01";
let requestDir = "";
let rememberedDir = "";

beforeEach(() => {
  ptys.clear();
  vi.clearAllMocks();
  requestDir = mkdtempSync(path.join(tmpdir(), "mt-cursor-req-"));
  rememberedDir = mkdtempSync(path.join(tmpdir(), "mt-cursor-remembered-"));
  sessionCwd.mockReturnValue(null);
});

/** The 4th positional argument of spawnCursorPty is the directory the session runs in. */
const spawnedCwd = () => (spawnCursorPty.mock.calls[0] as unknown as unknown[] | undefined)?.[3];

/** The entry the handler returned to startAndWire — the object whose `active` it sets. The spawner
 *  mock hands back a fresh object each call, so this is the very one the handler mutated. */
const spawnedEntry = (): { active?: boolean } | undefined => spawnCursorPty.mock.results[0]?.value as { active?: boolean } | undefined;

describe("handleCursorConnection", () => {
  it("runs a reconnect in the session's REMEMBERED directory, not the one the URL carried", async () => {
    sessionCwd.mockReturnValue(rememberedDir);
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}&session=${ID}&gui=0` } as never);
    expect(spawnedCwd()).toBe(rememberedDir);
  });

  it("runs a fresh cell in the directory the URL asked for", async () => {
    sessionCwd.mockReturnValue(null);
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}&gui=0` } as never);
    expect(spawnedCwd()).toBe(requestDir);
  });

  it("records the cell's directory as the remembered one, so the next reconnect agrees", async () => {
    sessionCwd.mockReturnValue(rememberedDir);
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}&session=${ID}&gui=0` } as never);
    expect(markDevTerminalSession).toHaveBeenCalledWith(ID, rememberedDir);
  });

  it("marks a GRID cell INACTIVE, so a finished turn raises the attention flag", async () => {
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}&gui=0` } as never);
    expect(spawnedEntry()?.active).toBe(false);
  });

  it("marks a SINGLE-VIEW cell active, so its own finished turn does not nag the viewer", async () => {
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}` } as never);
    expect(spawnedEntry()?.active).toBe(true);
  });

  // `markDevTerminalSession` is what `admitAgentSession` does with `devTerminal`, and it is the
  // choke point the chat sidebar's exclusion list reads — so it is the observable, not a proxy.
  it("records a grid cell as a dev terminal, and a single-view one as not", async () => {
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}&gui=0` } as never);
    expect(markDevTerminalSession).toHaveBeenCalled();
    vi.clearAllMocks();
    await handleCursorConnection(deps, fakeWs(), { url: `/ws/cursor?cwd=${encodeURIComponent(requestDir)}` } as never);
    expect(markDevTerminalSession).not.toHaveBeenCalled();
  });
});
