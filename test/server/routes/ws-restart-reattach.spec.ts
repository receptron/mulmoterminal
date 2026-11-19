// @vitest-environment node
// The #1536 fixes on the connect path, asserted through the real handlers.
//
// After a server restart `ptys` is empty while tmux still holds `mt-<session>` — the state every
// `!live` test misreads as a fresh spawn. The codex handler read the directory's tool groups on
// that path from the REQUEST cwd, which a restart reconnect often leaves at the default
// workspace — another directory's switches, exactly the wrong-cwd read #1514 fixed on the
// directory-MCP handler. And claude was the one agent endpoint that never asked
// clientStillConnected after its admission awaits, so a client that left mid-admission still got
// a pty — spawned after the socket's close event, which no later close handler can reap.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WebSocket } from "ws";

const mocks = vi.hoisted(() => ({
  // Whether tmux still holds the requested session — the restart-survivor case.
  tmuxHas: false,
  // What the dev-terminal cwd log remembers for the session, or null for one it never saw.
  rememberedCwd: null as string | null,
  // The session ids with a claude transcript on disk — the #1537 guard's claude evidence.
  claudeOnDisk: [] as string[],
  // Whether grok holds a conversation under the requested key, in any cwd partition.
  grokHas: false,
  // Lets a test simulate the client leaving inside an admission await.
  onEnsureWorktreeEnv: () => {},
  // Claude transcripts on disk, as `<cwd>:<id>` — what the connect asks before it resumes.
  transcripts: [] as string[],
  // The successor each cleared session's mark records (#3325).
  successors: new Map<string, string>(),
}));

const ptys = new Map<string, unknown>();
const codexRollouts = new Map<string, unknown>();
// Replaced by a test that holds the GUI tool restriction log back, as a restart can.
const restrictionLog = { hydrated: Promise.resolve() };
vi.mock("../../../server/session/registry.js", () => ({
  ptys,
  sessionCwd: () => mocks.rememberedCwd,
  devTerminalCwdsHydrated: Promise.resolve(),
  antigravityConversations: new Map(),
  antigravityConversationsHydrated: Promise.resolve(),
  museConversations: new Map(),
  museConversationsHydrated: Promise.resolve(),
  codexRollouts,
  codexRolloutsHydrated: Promise.resolve(),
  customAgentSessionsHydrated: Promise.resolve(),
  get guiGroupRestrictionsHydrated() {
    return restrictionLog.hydrated;
  },
  markDevTerminalSession: vi.fn(),
  markAttachedSessionPlaced: vi.fn(),
}));

// The #1537 guard's other evidence probes walk the developer's real home directories; each is
// pinned so a survivor's identity in these tests comes only from what a test declares.
vi.mock("../../../server/session/session-reads.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/session/session-reads.js")>();
  return {
    ...actual,
    claudeOnDiskSessionIds: () => new Set(mocks.claudeOnDisk),
    sessionExistsOnDisk: (id: string, cwd: string) => mocks.transcripts.includes(`${cwd}:${id}`) || actual.sessionExistsOnDisk(id, cwd),
  };
});

// The marks live in the real home; the connect only asks which sessions are cleared and to what.
vi.mock("../../../server/session/transcript/cleared-transcripts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/session/transcript/cleared-transcripts.js")>();
  return {
    ...actual,
    clearedTranscripts: { has: (id: string) => mocks.successors.has(id) },
    clearedClaudeIdOf: (id: string) => mocks.successors.get(id),
  };
});
vi.mock("../../../server/agents/antigravity/antigravity-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/antigravity/antigravity-session.js")>()),
  antigravityConversationExists: () => false,
}));
vi.mock("../../../server/agents/grok/grok-session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/grok/grok-session.js")>()),
  grokConversationExistsInAnyCwd: () => mocks.grokHas,
}));

// The guard shares one evidence snapshot per reconnect burst (EVIDENCE_SNAPSHOT_MS). Each test
// here is its own burst, so the clock steps past the window in beforeEach — otherwise one
// test's snapshot (its claude transcript set, baked at walk time) answers for the next.
let nowMs = 0;
vi.spyOn(Date, "now").mockImplementation(() => nowMs);

vi.mock("../../../server/infra/process/tmux.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/infra/process/tmux.js")>()),
  tmuxAvailable: () => true,
  tmuxHasSession: () => mocks.tmuxHas,
}));

// The rollout probe walks codex's real sessions root on disk; the resolver must not.
vi.mock("../../../server/agents/codex/codex-sessions.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/agents/codex/codex-sessions.js")>()),
  codexRolloutExists: () => false,
}));

// Whether every session reads as bound to a second login (#2215). Off unless a test says so, so the
// rest of this file runs on the default login exactly as before.
const account = { bound: false };
vi.mock("../../../server/session/accounts/account-sessions.js", () => ({
  accountSessions: new Map(),
  accountSessionsHydrated: Promise.resolve(),
  boundAccount: (agent: string, sessionId: string) => (account.bound ? { sessionId, agent, accountId: "work", home: "/srv/claude-work" } : undefined),
  rememberAccountSession: vi.fn(),
}));

const registeredGuiMcpGroups = vi.fn(() => Promise.resolve(["render"]));
vi.mock("../../../server/infra/process/gui-mcp-registration.js", () => ({ registeredGuiMcpGroups }));

vi.mock("../../../server/config/worktree/worktree-env.js", () => ({
  ensureWorktreeEnv: vi.fn(() => {
    mocks.onEnsureWorktreeEnv();
    return Promise.resolve({});
  }),
  reservedWorktreeEnv: () => ({}),
}));

// A real occupancy read runs git against the cwd; this spec is about the handlers' shape.
vi.mock("../../../server/session/credentials/worktree-session-limit.js", () => ({
  claimLaunch: () => ({ release: vi.fn(), contended: false }),
  worktreeOccupancy: () => Promise.resolve({ isWorktree: false, session: null }),
}));

const settleCredential = vi.fn();
vi.mock("../../../server/session/credentials/credential-announce.js", () => ({ settleCredential }));

const { handleClaudeConnection, handleCodexConnection } = await import("../../../server/routes/ws-routes.js");

const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee02";
const fakeTerm = () => ({ pid: 1, onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), kill: vi.fn(), resize: vi.fn() });

function fakeWs() {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(raw),
    close: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  };
}

const spawnClaudePty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const spawnCodexPty = vi.fn(() => ({ term: fakeTerm(), active: false }));
const makeDeps = () =>
  ({
    spawnClaudePty,
    spawnCodexPty,
    reattachPty: vi.fn(),
    setWaiting: vi.fn(),
    handleClientFrame: vi.fn(),
    handleClientClose: vi.fn(),
  }) as never;

let dir = "";
const request = (query = "") => ({ url: `/ws?cwd=${encodeURIComponent(dir)}${query}` });

beforeEach(() => {
  ptys.clear();
  codexRollouts.clear();
  vi.clearAllMocks();
  mocks.tmuxHas = false;
  mocks.rememberedCwd = null;
  mocks.claudeOnDisk = [];
  mocks.grokHas = false;
  mocks.onEnsureWorktreeEnv = () => {};
  mocks.transcripts = [];
  mocks.successors.clear();
  nowMs += 60_000;
  registeredGuiMcpGroups.mockResolvedValue(["render"]);
  account.bound = false;
  dir = mkdtempSync(path.join(tmpdir(), "mt-ws-restart-"));
  restrictionLog.hydrated = Promise.resolve();
});
afterEach(() => {
  ptys.clear();
  rmSync(dir, { recursive: true, force: true });
});

describe("/ws/codex after a server restart (tmux survivor, no live pty)", () => {
  // A restart reconnect often carries no ?cwd= at all, which resolves to the DEFAULT workspace —
  // so the groups must come from where the session really runs (the remembered cwd, #1514's
  // shape). Still read rather than skipped: if tmux dies between this handler and the spawn, the
  // fresh codex that ptySpawn's fallback starts must not come up with no GUI tools at all.
  it("keeps the id, passes no resume id, and reads the groups from the session's own cwd", async () => {
    mocks.tmuxHas = true;
    mocks.rememberedCwd = "/where-it-really-runs";
    await handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    expect(registeredGuiMcpGroups).toHaveBeenCalledWith("/where-it-really-runs", expect.anything());
    expect(spawnCodexPty).toHaveBeenCalledWith(SID, expect.anything(), null, dir, false, { mcpGroups: ["render"] });
  });

  it("reads the directory's groups from the request cwd for a genuinely fresh grid cell", async () => {
    await handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request("&gui=0"));
    expect(registeredGuiMcpGroups).toHaveBeenCalledWith(dir, expect.anything());
    expect(spawnCodexPty).toHaveBeenCalledWith(expect.any(String), expect.anything(), null, dir, false, { mcpGroups: ["render"] });
  });

  // The spawn reads the restriction synchronously (#3033): a resume that ran ahead of the log would
  // hand a restricted session every tool and claim them.
  it("does not spawn until the GUI tool restriction log has been read", async () => {
    let release = () => {};
    restrictionLog.hydrated = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connecting = handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spawnCodexPty).not.toHaveBeenCalled();
    release();
    await connecting;
    expect(spawnCodexPty).toHaveBeenCalledTimes(1);
  });
});

describe("/ws (claude) admission", () => {
  it("spawns nothing for a client that left during the admission awaits", async () => {
    const ws = fakeWs();
    mocks.onEnsureWorktreeEnv = () => {
      ws.readyState = 3; // the client closes while the handler awaits the worktree env
    };
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request());
    expect(spawnClaudePty).not.toHaveBeenCalled();
  });

  it("spawns for a client that stayed", async () => {
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request());
    expect(spawnClaudePty).toHaveBeenCalledTimes(1);
  });
});

// spawnClaudePty announces the rotation token for a process it starts. A same-process reattach
// (a reloaded page, a remounted cell) starts nothing, so the handler has to announce it itself or
// the cell's account mark stays blank until the next spawn (#2919).
describe("/ws (claude) rotation credential on a same-process reattach", () => {
  it("announces the credential to the reattaching socket and does not spawn", async () => {
    ptys.set(SID, { term: fakeTerm(), agent: "claude", active: false });
    const ws = fakeWs();
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).not.toHaveBeenCalled();
    expect(settleCredential).toHaveBeenCalledWith(SID, SID, true, ws);
  });

  it("tells a spawn apart from a reattach, and hands it the id the connection asked for", async () => {
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).toHaveBeenCalledTimes(1);
    expect(settleCredential).toHaveBeenCalledWith(SID, expect.any(String), false, expect.anything());
  });
});

// The #1537 guard, through the real handlers: a tmux-only survivor has no PtyEntry for
// wrongEndpointReason to compare, and `tmux new-session -A` attaches whatever runs in the pane
// while ignoring the argv — so a stale persisted cell could relabel a codex survivor as claude.
describe("tmux survivor identity (#1537)", () => {
  const codexEvidence = () => codexRollouts.set(SID, { sessionId: SID, conversationId: "c1", cwd: "/w", startedAt: 1 });

  it("refuses, loudly, a claude reconnect to a survivor codex's evidence claims", async () => {
    mocks.tmuxHas = true;
    codexEvidence();
    const ws = fakeWs();
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).not.toHaveBeenCalled();
    // An error frame, not a plain close: a plain close makes the client retry the same
    // mismatched id forever, and the defect is persisted state the user has to act on.
    expect(ws.sent.some((frame) => frame.includes("belongs to codex, not claude"))).toBe(true);
  });

  it("refuses the reverse — a codex reconnect to a survivor with a claude transcript", async () => {
    mocks.tmuxHas = true;
    mocks.claudeOnDisk = [SID];
    const ws = fakeWs();
    await handleCodexConnection(makeDeps(), ws as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    expect(spawnCodexPty).not.toHaveBeenCalled();
    expect(ws.sent.some((frame) => frame.includes("belongs to claude, not codex"))).toBe(true);
  });

  it("refuses a claude reconnect to a survivor grok's evidence claims", async () => {
    mocks.tmuxHas = true;
    mocks.grokHas = true;
    const ws = fakeWs();
    await handleClaudeConnection(makeDeps(), ws as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).not.toHaveBeenCalled();
    expect(ws.sent.some((frame) => frame.includes("belongs to grok, not claude"))).toBe(true);
  });

  it("serves a survivor to its own endpoint, evidence agreeing", async () => {
    mocks.tmuxHas = true;
    codexEvidence();
    await handleCodexConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&gui=0&session=${SID}`));
    expect(spawnCodexPty).toHaveBeenCalledTimes(1);
  });

  // Refuse-on-proof only: a shell/launcher survivor (or an agent that never reached its first
  // turn) leaves no evidence, and locking users out of a legitimately surviving session would
  // be worse than the mislabel this guard prevents.
  it("attaches an evidence-less survivor as requested", async () => {
    mocks.tmuxHas = true;
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${SID}`));
    expect(spawnClaudePty).toHaveBeenCalledTimes(1);
  });
});

// A grid cell on a second login reads its account's `.claude.json`, which has none of the
// launcher's per-directory switches — so the handler reads them and passes them to the spawn.
describe("/ws (claude) on a second login (#2215)", () => {
  const groupsPassed = (): unknown => {
    const calls: unknown[][] = spawnClaudePty.mock.calls;
    return calls.at(-1)?.[3];
  };

  it("hands a project cell on an account its directory's GUI groups", async () => {
    account.bound = true;
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request("&gui=0"));
    expect(groupsPassed()).toMatchObject({ directoryMcpGroups: ["render"] });
  });

  it("hands none on the default login, where the cell reads them itself", async () => {
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request("&gui=0"));
    expect(groupsPassed()).toMatchObject({ directoryMcpGroups: [] });
  });
});

// Restart after a `/clear` or an in-cell `/resume` reconnects under the cell's own id; the spawn
// must resume the conversation the cell moved to, never the frozen one (#3325).
describe("/ws (claude) reconnect of a cleared session", () => {
  const SUCCESSOR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeee03";
  const resumed = (): unknown[] | undefined => {
    const calls: unknown[][] = spawnClaudePty.mock.calls;
    return calls.at(-1)?.slice(0, 2);
  };

  it.each([
    ["with its own transcript on disk", true],
    ["moved before its first turn", false],
  ])("resumes the successor under the cell's id (%s)", async (_label, ownOnDisk) => {
    mocks.successors.set(SID, SUCCESSOR);
    mocks.transcripts = [`${dir}:${SUCCESSOR}`, ...(ownOnDisk ? [`${dir}:${SID}`] : [])];
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${SID}`));
    expect(resumed()).toEqual([SID, SUCCESSOR]);
  });

  // claude looks a `--resume` target up under the cwd it is launched in.
  it("does not resume a successor whose transcript is not under the connect's cwd", async () => {
    mocks.successors.set(SID, SUCCESSOR);
    mocks.transcripts = [`${dir}:${SID}`, `/somewhere-else:${SUCCESSOR}`];
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${SID}`));
    const [sessionId, resume] = resumed() ?? [];
    expect(resume).toBeNull();
    expect(sessionId).not.toBe(SID);
  });

  it("resumes its own transcript when the session is not cleared", async () => {
    mocks.transcripts = [`${dir}:${SID}`, `${dir}:${SUCCESSOR}`];
    await handleClaudeConnection(makeDeps(), fakeWs() as unknown as WebSocket, request(`&session=${SID}`));
    expect(resumed()).toEqual([SID, SID]);
  });
});
