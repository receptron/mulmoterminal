// The session an issue's work starts in, for whichever agent was asked for (#2228).
//
// An issue session is a PROJECT cell: it runs in the issue's worktree and takes its GUI tools from
// what that directory registered, the way a cell opened there would — not the full toolset a
// GUI-started chat gets, which is why spawnSeededSession is not reused as it stands. What each
// agent needs to get there differs (codex and copilot take a flag, cursor's file has to be written
// and approved first), so each has its own entry, kept in step with its cell in ws-routes.ts.
import { randomUUID } from "node:crypto";
import { isTerminalAgent, type TerminalAgent } from "../../../common/sessionAgent.js";
import { accountsForAgent, isAccountAgent, type AccountAgent, type AgentAccount } from "../../../common/agentAccounts.js";
import type { ToolGroup } from "../../../common/toolGroups.js";
import { spawnModeFor } from "../scheduled/background-chat.js";
import { issueSpawnOptions } from "./issue-spawn-options.js";
import { syncDirectoryMcpForSpawnAsync } from "./setup/spawn-directory-mcp.js";
import type { SpawnedSession } from "../../git/issue-work.js";
import type { SpawnAntigravityPty, SpawnClaudePty, SpawnCodexPty, SpawnCopilotPty, SpawnCursorPty, SpawnGrokPty, SpawnMusePty } from "./spawners.js";

export interface IssueSessionSpawnDeps {
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
  spawnCopilotPty: SpawnCopilotPty;
  spawnCursorPty: SpawnCursorPty;
  spawnAntigravityPty: SpawnAntigravityPty;
  spawnGrokPty: SpawnGrokPty;
  spawnMusePty: SpawnMusePty;
  /** The tool groups the directory registered, as a cell there would read them. */
  groupsFor: (cwd: string) => Promise<readonly ToolGroup[]>;
  /** Write cursor's directory file and approve its entries, before cursor reads either. */
  syncCursorMcp: (cwd: string, groups: readonly ToolGroup[]) => Promise<void>;
  /** The worktree's own PORT / DB_NAME (#1367), reserved as a cell's fresh spawn reserves them. A
   *  worktree cut just now already has them; a reopened one may not. */
  reserveWorktreeEnv: (cwd: string) => Promise<void>;
  /** Bind a new session to an account before it spawns, so its spawn runs on that login (#2215). */
  bindAccount: (agent: AccountAgent, sessionId: string, accountId: string) => Promise<void>;
  newSessionId?: () => string;
}

/** `claudePermissionMode` starts a Claude session in that `--permission-mode` instead of the
 *  server's; the other agents have no such mode to start in, and start as they always do. */
export interface IssueSessionOptions {
  claudePermissionMode?: string;
  /** Hand claude, codex or copilot the whole GUI MCP instead of the directory's groups (#3413). The
   *  other agents read theirs from a file every session in the directory shares, and ignore it. */
  allTools?: boolean;
  /** Let codex's sandbox reach the network (a reviewer or an implementer, both of which talk to
   *  GitHub). The other agents have no such sandbox switch, and ignore it. */
  networkAccess?: boolean;
  /** Never stop codex on an approval prompt (a session nobody is watching). The other agents ignore it. */
  neverAsk?: boolean;
  /** More paths codex's sandbox may write (the worktree's git metadata, for an implementer). The
   *  other agents ignore it. */
  writableRoots?: readonly string[];
}

/** `account` is an id `requestedIssueAccount` accepted for this agent, or null for the default login. */
export type SpawnIssueSession = (
  agent: TerminalAgent,
  cwd: string,
  seed: string,
  run: boolean,
  account: string | null,
  options?: IssueSessionOptions,
) => Promise<SpawnedSession>;

interface SpawnRequest {
  sessionId: string;
  cwd: string;
  seed: string;
  run: boolean;
  claudePermissionMode: string | undefined;
  allTools: boolean;
  networkAccess: boolean;
  neverAsk: boolean;
  writableRoots: readonly string[];
}

type AgentSpawn = (request: SpawnRequest, deps: IssueSessionSpawnDeps) => Promise<void>;

/** The agent an issue-start request asked for. Absent means Claude, which is what every issue
 *  session was before the field existed; anything that is not an agent is refused (null) rather
 *  than quietly started as Claude. */
export function requestedIssueAgent(raw: unknown): TerminalAgent | null {
  if (raw === undefined) return "claude";
  return typeof raw === "string" && isTerminalAgent(raw) ? raw : null;
}

/** The account an issue-start request asked for (#2226). Absent or null is the default login; the
 *  id of one of THIS agent's configured accounts is itself. Anything else is refused rather than
 *  started on the default login, the one outcome nobody would notice was wrong. */
export function requestedIssueAccount(
  raw: unknown,
  agent: TerminalAgent,
  accounts: readonly AgentAccount[],
): { ok: true; account: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, account: null };
  return typeof raw === "string" && accountsForAgent(accounts, agent).some((account) => account.id === raw) ? { ok: true, account: raw } : { ok: false };
}

/** A per-spawn agent's options: the directory's groups for a cell-shaped session, none when it
 *  carries every tool and would only list them twice. */
const perSpawnMcp = async (
  deps: IssueSessionSpawnDeps,
  cwd: string,
  seed: string,
  allTools: boolean,
): Promise<{ mcpGroups: readonly ToolGroup[]; initialPrompt: string }> => ({
  mcpGroups: allTools ? [] : await deps.groupsFor(cwd),
  initialPrompt: seed,
});

const directoryGroupsSpawn =
  (pick: (deps: IssueSessionSpawnDeps) => SpawnAntigravityPty | SpawnGrokPty | SpawnMusePty): AgentSpawn =>
  async ({ sessionId, cwd, seed }, deps) => {
    pick(deps)(sessionId, null, null, cwd, { mcpGroups: await deps.groupsFor(cwd), initialPrompt: seed });
  };

// A Record over the agents, so hosting a new one is a type error here rather than an issue start
// that silently spawns Claude under its name.
const AGENT_SPAWN: Record<TerminalAgent, AgentSpawn> = {
  claude: async ({ sessionId, cwd, seed, run, claudePermissionMode, allTools }, deps) => {
    deps.spawnClaudePty(sessionId, null, null, issueSpawnOptions(cwd, seed, run, claudePermissionMode, allTools));
  },
  codex: async ({ sessionId, cwd, seed, allTools, networkAccess, neverAsk, writableRoots }, deps) => {
    deps.spawnCodexPty(sessionId, null, null, cwd, allTools, {
      ...(await perSpawnMcp(deps, cwd, seed, allTools)),
      ...(networkAccess ? { networkAccess } : {}),
      ...(neverAsk ? { neverAsk } : {}),
      ...(writableRoots.length > 0 ? { writableRoots } : {}),
    });
  },
  copilot: async ({ sessionId, cwd, seed, allTools }, deps) => {
    deps.spawnCopilotPty(sessionId, null, null, cwd, allTools, await perSpawnMcp(deps, cwd, seed, allTools));
  },
  // Cursor loads only servers it has APPROVED, and an unapproved one is silently absent, so the file
  // is written and approved before the spawn — as its cell does (ws-routes.ts).
  cursor: async ({ sessionId, cwd, seed }, deps) => {
    const mcpGroups = await deps.groupsFor(cwd);
    await syncDirectoryMcpForSpawnAsync(sessionId, cwd, mcpGroups, deps.syncCursorMcp);
    deps.spawnCursorPty(sessionId, null, null, cwd, { mcpGroups, initialPrompt: seed });
  },
  antigravity: directoryGroupsSpawn((deps) => deps.spawnAntigravityPty),
  grok: directoryGroupsSpawn((deps) => deps.spawnGrokPty),
  muse: directoryGroupsSpawn((deps) => deps.spawnMusePty),
};

export function createIssueSessionSpawner(deps: IssueSessionSpawnDeps): SpawnIssueSession {
  const newSessionId = deps.newSessionId ?? randomUUID;
  return async (agent, cwd, seed, run, account, options = {}) => {
    const sessionId = newSessionId();
    // Always a fresh session (a new id), so never the reattach a cell skips this for.
    await deps.reserveWorktreeEnv(cwd);
    // Bound BEFORE the spawn: the spawn reads the binding to choose the login it runs under.
    if (account !== null && isAccountAgent(agent)) await deps.bindAccount(agent, sessionId, account);
    await AGENT_SPAWN[agent](
      {
        sessionId,
        cwd,
        seed,
        run,
        claudePermissionMode: options.claudePermissionMode,
        allTools: options.allTools === true,
        networkAccess: options.networkAccess === true,
        neverAsk: options.neverAsk === true,
        writableRoots: options.writableRoots ?? [],
      },
      deps,
    );
    // Only Claude can leave the seed as a draft; the rule is spawnModeFor's, not a second copy.
    return { sessionId, agent, seedRuns: spawnModeFor(agent, !run) !== "claude-draft" };
  };
}
