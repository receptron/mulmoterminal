// The one step every agent spawner ends on: start the program in a pty, log the start line, and
// register the entry. What differs per agent — the program, its argv, its environment, the note on
// the start line — is decided by the spawner and handed in; nothing here chooses any of it.
import type { WebSocket } from "ws";
import type { SessionAgent } from "../../../common/sessionAgent.js";
import { ptySpawn, type PtySpawnEnv } from "./pty-spawn.js";
import { ptyStartLine } from "./pty-exit-log.js";
import { ptys } from "../registry.js";
import type { PtyEntry } from "../types.js";

export interface AgentPtyStart {
  sessionId: string;
  ws: WebSocket | null;
  cwd: string;
  /** Recorded on the entry and named in the start line — the agent, whatever program runs it. */
  agent: SessionAgent;
  /** The program the pty runs, and its whole argv. */
  file: string;
  args: string[];
  spawnEnv: PtySpawnEnv;
  /** Trailing text on the start line: which conversation was resumed, which custom agent ran it. */
  note: string | null;
}

/** `spawnedAtMs` comes back because the caller wires the relay (and may have its own work to do
 *  first); `reattached` because codex picks how to tail its rollout from it. */
export interface StartedAgentPty {
  entry: PtyEntry;
  spawnedAtMs: number;
  /** tmux attached to an agent that was already running rather than starting a new one. */
  reattached: boolean;
}

/** Start the pty and register it. A caller that wrote session files first calls this inside its
 *  `withSettingsCleanup`, so a spawn that throws takes those files with it. */
export function startAgentPty(start: AgentPtyStart): StartedAgentPty {
  const { sessionId, ws, cwd, agent, file, args, spawnEnv, note } = start;
  const { term, tmux, reattached } = ptySpawn(sessionId, file, args, cwd, true, { ...spawnEnv, recordExit: true });
  const spawnedAtMs = Date.now();
  console.log(ptyStartLine({ agent, pid: term.pid, cwd, tmux, reattached, sessionId, note }));
  const entry: PtyEntry = { term, ws, buffer: "", cwd, tmux, reattached, active: false, agent };
  ptys.set(sessionId, entry);
  return { entry, spawnedAtMs, reattached };
}
