// @vitest-environment node
// The browser sends the terminal's geometry the instant its socket opens — before the server has
// resolved the session, probed tmux or read the worktree. A socket with no `message` listener
// drops what arrives, and the early-frame buffer used to be attached only at the session
// announcement, after those awaits. A cell that mounted beside a pane about to close connected
// with the split width on its URL and sent the real width on `open`; the correction fell into
// that window and the pty ran at the split width (#2986).
//
// Two pins. The first drives a real handler and emits a frame SYNCHRONOUSLY after calling it —
// the handler is parked at its first await — and asserts the frame reaches the pty's frame
// handler once the spawn is wired. The second reads the route file and checks every handler takes
// the buffer before its first await, so an endpoint added later cannot reopen the window.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

const ptys = new Map<string, unknown>();
vi.mock("../../../server/session/registry.js", () => ({
  ptys,
  sessionCwd: () => null,
  devTerminalCwdsHydrated: Promise.resolve(),
  antigravityConversations: new Map(),
  antigravityConversationsHydrated: Promise.resolve(),
  museConversations: new Map(),
  museConversationsHydrated: Promise.resolve(),
  codexRollouts: new Map(),
  codexRolloutsHydrated: Promise.resolve(),
  customAgentSessionsHydrated: Promise.resolve(),
  markDevTerminalSession: vi.fn(),
  markAttachedSessionPlaced: vi.fn(),
}));
vi.mock("../../../server/infra/process/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/process/tmux.js")>()),
  tmuxAvailable: () => false,
  tmuxHasSession: () => false,
}));
vi.mock("../../../server/agents/copilot/copilot-sessions.js", () => ({
  copilotSessionExistsForCwd: async () => false,
  copilotSessionExists: () => false,
  listCopilotSessionsForCwd: async () => [],
  copilotSessionStatePath: () => "/nonexistent",
}));
vi.mock("../../../server/config/worktree/worktree-env.js", () => ({
  ensureWorktreeEnv: async () => ({}),
  reservedWorktreeEnv: () => ({}),
}));
vi.mock("../../../server/session/credentials/worktree-session-limit.js", () => ({
  claimLaunch: () => ({ release: vi.fn(), contended: false }),
  worktreeOccupancy: () => Promise.resolve({ isWorktree: false, session: null }),
}));
vi.mock("../../../server/infra/process/gui-mcp-registration.js", () => ({ registeredGuiMcpGroups: vi.fn(async () => []) }));

const { handleCopilotConnection } = await import("../../../server/routes/ws-routes.js");

// Enough of a socket for the handler: it is open, it records listeners so a test can emit into
// them, and it swallows what the server sends.
class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  on(event: string, cb: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return this;
  }
  once(event: string, cb: (...args: unknown[]) => void) {
    return this.on(event, cb);
  }
  off(event: string, cb: (...args: unknown[]) => void) {
    this.listeners.set(
      event,
      (this.listeners.get(event) ?? []).filter((l) => l !== cb),
    );
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const l of [...(this.listeners.get(event) ?? [])]) l(...args);
  }
  send() {}
  close() {}
}
const asWebSocket = (socket: FakeSocket): WebSocket => socket as unknown as WebSocket;

const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });
const handleClientFrame = vi.fn();
const deps = {
  spawnCopilotPty: vi.fn(() => ({ term: fakeTerm(), active: false })),
  reattachPty: vi.fn(),
  handleClientFrame,
  handleClientClose: vi.fn(),
} as never;

let requestDir = "";
beforeEach(() => {
  ptys.clear();
  vi.clearAllMocks();
  requestDir = mkdtempSync(path.join(tmpdir(), "mt-early-"));
});

describe("a frame sent the instant the socket opened", () => {
  it("reaches the pty after the spawn, although the handler was still admitting the session", async () => {
    const socket = new FakeSocket();
    const resize = JSON.stringify({ type: "resize", cols: 140, rows: 45 });
    const handled = handleCopilotConnection(deps, asWebSocket(socket), { url: `/ws/copilot?cwd=${encodeURIComponent(requestDir)}&gui=0` } as never);
    // Synchronously: the handler is parked at its first await, exactly where a real browser's
    // first frame lands.
    socket.emit("message", resize);
    await handled;
    expect(handleClientFrame).toHaveBeenCalledTimes(1);
    expect(handleClientFrame.mock.calls[0]?.[2]).toBe(resize);
  });
});

describe("every connection handler", () => {
  const source = readFileSync(path.join(import.meta.dirname, "../../../server/routes/ws-routes.ts"), "utf8");
  const handlers = [
    "handleClaudeConnection",
    "handleLaunchConnection",
    "handleCodexConnection",
    "handleCopilotConnection",
    "handleCursorConnection",
    "handleDirectoryMcpAgentConnection",
    "startRunTerminal",
  ];
  // The slice from the handler's signature to its first await — where a frame can be dropped.
  const beforeFirstAwait = (name: string): string => {
    const start = source.indexOf(`function ${name}(`);
    expect(start, `${name} is no longer in ws-routes.ts — rename it here too`).toBeGreaterThan(-1);
    const firstAwait = source.indexOf("await ", start);
    expect(firstAwait, `${name} has no await — the check does not apply`).toBeGreaterThan(start);
    return source.slice(start, firstAwait);
  };
  it.each(handlers)("%s takes the early-frame buffer before its first await", (name) => {
    expect(beforeFirstAwait(name)).toContain("acceptTerminalConnection(ws, req)");
  });
});
