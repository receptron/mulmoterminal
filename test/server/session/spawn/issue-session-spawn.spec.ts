// @vitest-environment node
// An issue session is a PROJECT cell for whichever agent was asked for (#2228): each agent has to
// reach its OWN spawner, with the directory's GUI tool groups rather than the full toolset, and
// cursor's file has to be written and approved before cursor starts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TERMINAL_AGENTS, type TerminalAgent } from "../../../../common/sessionAgent";
import type { ToolGroup } from "../../../../common/toolGroups";

const wouldReattach = vi.hoisted(() => ({ value: false }));
vi.mock("../../../../server/session/pty/pty-spawn.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ptyWouldReattach: () => wouldReattach.value,
}));

const { createIssueSessionSpawner, requestedIssueAccount, requestedIssueAgent } = await import("../../../../server/session/spawn/issue-session-spawn.js");
import type { AgentAccount } from "../../../../common/agentAccounts";

const GROUPS: readonly ToolGroup[] = ["render"];
const CWD = "/wt/7-thing";
const SEED = "GitHub issue #7: The thing";

function setup() {
  const calls: Array<{ spawner: string; args: unknown[] }> = [];
  const order: string[] = [];
  const record =
    (spawner: string) =>
    (...args: unknown[]) => {
      calls.push({ spawner, args });
      order.push(`spawn:${spawner}`);
      return {} as never;
    };
  const syncCursorMcp = vi.fn(async (cwd: string, groups: readonly ToolGroup[]) => {
    order.push(`sync:${cwd}:${groups.join(",")}`);
  });
  const groupsFor = vi.fn(async () => {
    order.push("groups");
    return GROUPS;
  });
  const reserveWorktreeEnv = vi.fn(async (cwd: string) => {
    order.push(`reserve:${cwd}`);
  });
  const bindAccount = vi.fn(async (agent: string, sessionId: string, accountId: string) => {
    order.push(`bind:${agent}:${sessionId}:${accountId}`);
  });
  const spawn = createIssueSessionSpawner({
    spawnClaudePty: record("claude"),
    spawnCodexPty: record("codex"),
    spawnCopilotPty: record("copilot"),
    spawnCursorPty: record("cursor"),
    spawnAntigravityPty: record("antigravity"),
    spawnGrokPty: record("grok"),
    spawnMusePty: record("muse"),
    groupsFor,
    syncCursorMcp,
    reserveWorktreeEnv,
    bindAccount,
    newSessionId: () => "s-1",
  });
  return { spawn, calls, order, syncCursorMcp, groupsFor, reserveWorktreeEnv, bindAccount };
}

beforeEach(() => {
  wouldReattach.value = false;
});

describe("createIssueSessionSpawner", () => {
  it.each(TERMINAL_AGENTS)("starts %s through its own spawner, and nothing else", async (agent) => {
    const { spawn, calls } = setup();
    const session = await spawn(agent, CWD, SEED, false, null);
    expect(calls.map((c) => c.spawner)).toEqual([agent]);
    expect(session).toMatchObject({ sessionId: "s-1", agent });
  });

  // The desktop's draft, the phone's run (#1253): Claude's two shapes, never both keys at once.
  it("gives Claude the seed as a draft, or as a first turn when asked to run", async () => {
    const { spawn, calls } = setup();
    await spawn("claude", CWD, SEED, false, null);
    await spawn("claude", CWD, SEED, true, null);
    expect(calls[0].args).toEqual(["s-1", null, null, { cwd: CWD, attachGuiMcp: false, draft: SEED }]);
    expect(calls[1].args).toEqual(["s-1", null, null, { cwd: CWD, attachGuiMcp: false, initialPrompt: SEED }]);
  });

  // #3334: a Library promotion starts Claude in plan mode; the agents without one start as always.
  it("starts Claude in the permission mode asked for, and leaves the others as they are", async () => {
    const { spawn, calls } = setup();
    await spawn("claude", CWD, SEED, true, null, { claudePermissionMode: "plan" });
    await spawn("codex", CWD, SEED, true, null, { claudePermissionMode: "plan" });
    expect(calls[0].args).toEqual(["s-1", null, null, { cwd: CWD, attachGuiMcp: false, permissionMode: "plan", initialPrompt: SEED }]);
    expect(calls[1].args).toEqual(["s-1", null, null, CWD, false, { mcpGroups: GROUPS, initialPrompt: SEED }]);
  });

  // attachGuiMcp:false is what makes these a project cell rather than a GUI-started chat.
  it.each(["codex", "copilot"] as const)("gives %s the directory's groups and not the full toolset", async (agent) => {
    const { spawn, calls, groupsFor } = setup();
    await spawn(agent, CWD, SEED, false, null);
    expect(groupsFor).toHaveBeenCalledWith(CWD);
    expect(calls[0].args).toEqual(["s-1", null, null, CWD, false, { mcpGroups: GROUPS, initialPrompt: SEED }]);
  });

  // #3413: a session's implementer carries every tool, so the review tools reach it; the groups would only repeat them.
  it("hands claude, codex and copilot every tool when asked, without the directory's groups", async () => {
    const { spawn, calls, groupsFor } = setup();
    await spawn("claude", CWD, SEED, true, null, { allTools: true });
    await spawn("codex", CWD, SEED, true, null, { allTools: true });
    await spawn("copilot", CWD, SEED, true, null, { allTools: true });
    expect(calls.map((c) => c.args)).toEqual([
      ["s-1", null, null, { cwd: CWD, attachGuiMcp: true, initialPrompt: SEED }],
      ["s-1", null, null, CWD, true, { mcpGroups: [], initialPrompt: SEED }],
      ["s-1", null, null, CWD, true, { mcpGroups: [], initialPrompt: SEED }],
    ]);
    expect(groupsFor).not.toHaveBeenCalled();
  });

  // A reviewer or an implementer talks to GitHub with gh, which codex's default sandbox cannot reach.
  it("lets codex's sandbox reach the network only when asked, and changes nothing for the others", async () => {
    const { spawn, calls } = setup();
    await spawn("codex", CWD, SEED, true, null, { networkAccess: true });
    await spawn("claude", CWD, SEED, true, null, { networkAccess: true });
    await spawn("codex", CWD, SEED, true, null);
    expect(calls.map((c) => c.args)).toEqual([
      ["s-1", null, null, CWD, false, { mcpGroups: GROUPS, initialPrompt: SEED, networkAccess: true }],
      ["s-1", null, null, { cwd: CWD, attachGuiMcp: false, initialPrompt: SEED }],
      ["s-1", null, null, CWD, false, { mcpGroups: GROUPS, initialPrompt: SEED }],
    ]);
  });

  it("hands codex the extra writable roots, and nothing to the others or for an empty list", async () => {
    const { spawn, calls } = setup();
    await spawn("codex", CWD, SEED, true, null, { writableRoots: ["/repo/.git/objects"] });
    await spawn("claude", CWD, SEED, true, null, { writableRoots: ["/repo/.git/objects"] });
    await spawn("codex", CWD, SEED, true, null, { writableRoots: [] });
    expect(calls.map((c) => c.args)).toEqual([
      ["s-1", null, null, CWD, false, { mcpGroups: GROUPS, initialPrompt: SEED, writableRoots: ["/repo/.git/objects"] }],
      ["s-1", null, null, { cwd: CWD, attachGuiMcp: false, initialPrompt: SEED }],
      ["s-1", null, null, CWD, false, { mcpGroups: GROUPS, initialPrompt: SEED }],
    ]);
  });

  it.each(["antigravity", "grok", "muse"] as const)("gives %s the directory's groups", async (agent) => {
    const { spawn, calls } = setup();
    await spawn(agent, CWD, SEED, false, null);
    expect(calls[0].args).toEqual(["s-1", null, null, CWD, { mcpGroups: GROUPS, initialPrompt: SEED }]);
  });

  // Cursor loads only APPROVED servers and an unapproved one is silently absent, so the order is the
  // behaviour: written and approved first, spawned after.
  it("writes and approves cursor's directory file before starting cursor", async () => {
    const { spawn, calls, order } = setup();
    await spawn("cursor", CWD, SEED, false, null);
    expect(order).toEqual([`reserve:${CWD}`, "groups", `sync:${CWD}:render`, "spawn:cursor"]);
    expect(calls[0].args).toEqual(["s-1", null, null, CWD, { mcpGroups: GROUPS, initialPrompt: SEED }]);
  });

  // The file is shared by every cursor session in the directory; a session that would only reattach
  // must not rewrite it (spawn-directory-mcp.ts).
  it("leaves cursor's file alone when the session would only reattach", async () => {
    wouldReattach.value = true;
    const { spawn, syncCursorMcp } = setup();
    await spawn("cursor", CWD, SEED, false, null);
    expect(syncCursorMcp).not.toHaveBeenCalled();
  });

  // A reopened worktree may never have had its PORT / DB_NAME written; a cell's fresh spawn reserves
  // them first, and so does this, for every agent (#1367).
  it.each(TERMINAL_AGENTS)("reserves the worktree's env before starting %s", async (agent) => {
    const { spawn, order } = setup();
    await spawn(agent, CWD, SEED, false, null);
    expect(order[0]).toBe(`reserve:${CWD}`);
    expect(order.at(-1)).toBe(`spawn:${agent}`);
  });

  // Only a Claude draft waits for an Enter; every other seed is already running.
  it.each(TERMINAL_AGENTS.flatMap((agent) => [false, true].map((run) => [agent, run] as const)))(
    "reports whether %s's seed runs (run=%s)",
    async (agent, run) => {
      const { spawn } = setup();
      const session = await spawn(agent, CWD, SEED, run, null);
      expect(session.seedRuns).toBe(agent !== "claude" || run);
    },
  );
});

// #2226. The spawn reads the binding to choose the login, so it has to exist before the spawn does.
describe("createIssueSessionSpawner — accounts", () => {
  it.each(["claude", "codex"] as const)("binds %s to the chosen account before spawning it", async (agent) => {
    const { spawn, order } = setup();
    await spawn(agent, CWD, SEED, false, "work");
    expect(order.indexOf(`bind:${agent}:s-1:work`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`bind:${agent}:s-1:work`)).toBeLessThan(order.indexOf(`spawn:${agent}`));
  });

  it("binds nothing for the default login", async () => {
    const { spawn, bindAccount } = setup();
    await spawn("claude", CWD, SEED, false, null);
    expect(bindAccount).not.toHaveBeenCalled();
  });

  // Only claude and codex keep a login an account can move; requestedIssueAccount refuses any other
  // agent's account, and the spawner does not bind one even if handed it.
  it("binds nothing for an agent an account cannot move", async () => {
    const { spawn, bindAccount } = setup();
    await spawn("grok", CWD, SEED, false, "work");
    expect(bindAccount).not.toHaveBeenCalled();
  });
});

describe("requestedIssueAccount", () => {
  const ACCOUNTS: AgentAccount[] = [
    { id: "work", label: "Work", agent: "claude", home: "~/.claude-work" },
    { id: "side", label: "Side", agent: "codex", home: "~/.codex-side" },
  ];

  it.each([undefined, null])("reads %j as the default login", (raw) => {
    expect(requestedIssueAccount(raw, "claude", ACCOUNTS)).toEqual({ ok: true, account: null });
  });

  it("accepts one of the agent's own accounts", () => {
    expect(requestedIssueAccount("work", "claude", ACCOUNTS)).toEqual({ ok: true, account: "work" });
    expect(requestedIssueAccount("side", "codex", ACCOUNTS)).toEqual({ ok: true, account: "side" });
  });

  // Refused rather than started on the default login: the wrong subscription is invisible.
  it.each<[unknown, TerminalAgent]>([
    ["side", "claude"],
    ["work", "codex"],
    ["work", "grok"],
    ["nope", "claude"],
    ["", "claude"],
    [7, "claude"],
    [{ id: "work" }, "claude"],
    [["work"], "claude"],
  ])("refuses %j for %s", (raw, agent) => {
    expect(requestedIssueAccount(raw, agent, ACCOUNTS)).toEqual({ ok: false });
  });
});

describe("requestedIssueAgent", () => {
  it("reads an absent agent as Claude", () => {
    expect(requestedIssueAgent(undefined)).toBe("claude");
  });

  it.each(TERMINAL_AGENTS)("accepts %s", (agent: TerminalAgent) => {
    expect(requestedIssueAgent(agent)).toBe(agent);
  });

  // Refused rather than coerced: a caller that named an agent meant that one.
  it.each([null, "", "Claude", "CODEX", " codex", "gemini", "shell", 0, 1, true, {}, ["codex"], { agent: "codex" }])("refuses %j", (raw) => {
    expect(requestedIssueAgent(raw)).toBeNull();
  });
});
