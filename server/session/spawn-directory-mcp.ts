// Starting an agent whose MCP servers come from a file in the DIRECTORY rather than from a
// per-session flag: agy (`.agents/mcp_config.json`) and grok (`.grok/config.toml`).
//
// That one fact is what makes these two the same shape and claude/codex a different one. Because
// the file is SHARED by every session in the directory, writing it is not a private act — it
// speaks for terminals this spawn knows nothing about — which is where both of the bugs below
// came from, and why the rule lives here once instead of in each spawner (#1441, #1443).
import type { WebSocket } from "ws";
import { PORT } from "../config/env.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import type { ToolGroup } from "../../common/toolGroups.js";
import { guiMcpEnv } from "./mcp-config.js";
import { ptySpawn, ptyWouldReattach } from "./pty-spawn.js";
import { ptyStartLine } from "./pty-exit-log.js";
import { ptys } from "./registry.js";
import type { PtyEntry } from "./types.js";

/** What such a spawn takes beyond the session itself. */
export interface DirectoryMcpSpawnOptions {
  /** The tool groups this cell's DIRECTORY has registered, read by the caller (the lookup reads
   *  Claude Code's config files, and this is sync).
   *
   *  REQUIRED, and deliberately not defaulted: the file is shared by every session in the
   *  directory, so a caller that had not looked the groups up would not merely spawn without GUI
   *  tools — it would clear the entries every other session there is using. */
  mcpGroups: readonly ToolGroup[];
  /** Run this as the session's first turn (a collection action, a background chat). */
  initialPrompt?: string | null;
}

/** The signature both directory-MCP spawners have, for a caller that holds either one. */
export type SpawnDirectoryMcpPty = (
  sessionId: string,
  ws: WebSocket | null,
  resumeConversationId: string | null,
  cwd: string,
  options: DirectoryMcpSpawnOptions,
) => PtyEntry;

/** Point the directory's shared config at `groups` — but only for a spawn that will really START
 *  the agent.
 *
 *  After a server restart `ptys` is empty while the tmux session can still be there, so a spawner
 *  is reached for what turns out to be a REATTACH — and the agent already running in that pane
 *  read the config file once, at its own start. Rewriting it now cannot affect that process; it
 *  can only speak for the OTHER sessions in the directory, which is the one thing this must never
 *  do.
 *
 *  The damaging case is not hypothetical: the route resolves the groups with `.catch(() => [])`,
 *  so a transient failure reading Claude Code's config arrives as "no groups" and would clear the
 *  entries every live session in that directory is using (#1441, #1443).
 *
 *  Its own function rather than a step inside the spawn, so a caller that must observe the world
 *  as the agent will find it can do so BETWEEN the two — which is what antigravity's conversation
 *  snapshot is. */
export function syncDirectoryMcpForSpawn(
  sessionId: string,
  cwd: string,
  groups: readonly ToolGroup[],
  sync: (cwd: string, groups: readonly ToolGroup[]) => void,
): void {
  if (!ptyWouldReattach(sessionId, true)) sync(cwd, groups);
}

/** The same rule for a sync that must be AWAITED, which cursor's is: writing its file is only half
 *  the registration — the ids then have to be approved through `cursor-agent mcp enable`, and an
 *  unapproved server is invisible to the agent rather than prompted for (cursor-mcp.ts). So the
 *  caller is the route, which is async, and the reattach guard has to travel with it rather than
 *  stay behind in the sync spawner. */
export async function syncDirectoryMcpForSpawnAsync(
  sessionId: string,
  cwd: string,
  groups: readonly ToolGroup[],
  sync: (cwd: string, groups: readonly ToolGroup[]) => Promise<void>,
): Promise<void> {
  if (!ptyWouldReattach(sessionId, true)) await sync(cwd, groups);
}

interface DirectoryMcpStart {
  sessionId: string;
  ws: WebSocket | null;
  cwd: string;
  agent: SessionAgent;
  bin: string;
  binEnvVar: string;
  args: string[];
  /** Named in the start line, so the log says which conversation a session picked up. */
  resumeConversationId: string | null;
}

/** Start the pty and register it. `spawnedAtMs` comes back because the caller wires the relay
 *  (and may have its own work to do first). */
export function startDirectoryMcpPty(start: DirectoryMcpStart): { entry: PtyEntry; spawnedAtMs: number } {
  const { sessionId, ws, cwd, agent, bin, binEnvVar, args, resumeConversationId } = start;
  // The session id reaches the GUI MCP bridge through this environment and nowhere else — the
  // config file the agent reads is shared by every session in the directory.
  const { term, tmux, reattached } = ptySpawn(sessionId, bin, args, cwd, true, { env: guiMcpEnv(sessionId, PORT), binEnvVar });
  const spawnedAtMs = Date.now();
  const note = resumeConversationId ? `resume ${resumeConversationId}` : null;
  console.log(ptyStartLine({ agent, pid: term.pid, cwd, tmux, reattached, sessionId, note }));

  const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, active: false, agent };
  ptys.set(sessionId, entry);
  return { entry, spawnedAtMs };
}
