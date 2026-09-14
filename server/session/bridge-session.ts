// Which SESSION a GUI MCP bridge process belongs to, when nothing told it.
//
// Every other host hands the answer over: claude and codex get a session-scoped URL at spawn, and
// agy and grok read a config file whose server entry the session's own environment completes
// (guiMcpEnv — the bridge is their child, so it inherits it).
//
// muse breaks that, and it is not a detail that can be worked around at the call site: a plugin's
// MCP server is started with a CURATED ENVIRONMENT — measured at 16 variables, all of them muse's
// own (MUSE_PLUGIN_ROOT, PATH, HOME, TMPDIR …) — and neither the muse process's environment nor
// the manifest's own `env` block reaches it. So the bridge starts knowing its group and its port
// (both are argv, which IS ours) and nothing at all about the session.
//
// CURSOR IS THE SECOND, and it took an end-to-end run to find: it reads a config file per directory
// like agy, so the file was written and approved and the cell still saw no tools. Measured against
// cursor-agent 2026.09.10-fd3934a — cursor starts an MCP server with the entry's own `env` block on
// a CURATED base, NOT on its own environment. The proof is in which half arrived while the entry was
// still agy-shaped: the group, named in that entry's `env`, reached the bridge and the port, left to
// inheritance as agy leaves it, did not — so the bridge refused with "the mulmoterminal port is not
// set". Both travel as argv now. So cursor is agy-shaped for the FILE and
// muse-shaped for the SESSION, and its entry carries `--group` and `--port` on the command line for
// the same reason muse's manifest does.
//
// Two things do survive, and between them they answer it:
//
//   THE PROCESS TREE. The bridge is a descendant of the agent process, which is the root process of
//   the tmux pane whose session name is the session id this server minted. `tmux list-panes` maps
//   that pane pid to that name, so walking up from the bridge until a pane pid is hit is exact —
//   it distinguishes two cells of the same agent in ONE directory, which nothing else here can.
//
//   THE PTY. With tmux persistence off there is no pane to match, and there the agent process IS a
//   child of the pty this server spawned — so the pty's own pid appears in the same chain.
//
// The working directory is deliberately NOT one of them, and that is a correction: a cwd fallback
// ("the single live muse session in this directory") shipped first and is unsafe, because the
// plugin is machine-wide. A muse the USER started in a normal terminal, in a directory that also
// holds one of our cells, matches no pane and no pty of ours — and would have been handed that
// cell's session id and groups, letting an unrelated process draw into someone's Canvas and write
// artifacts under their session (Codex review on #1514). Both facts above are proofs of descent;
// a shared directory is not.
import { ptys } from "./registry.js";
import type { SessionAgent } from "../../common/sessionAgent.js";
import type { ToolGroup } from "../../common/toolGroups.js";

/** What the resolver needs to know about the world, so the rule itself is pure and testable. */
export interface BridgeSessionFacts {
  /** Pane root pid -> session id, from tmux. */
  panePids: ReadonlyMap<number, string>;
  /** The ancestors of the bridge, nearest first, INCLUDING its own pid. */
  ancestors: readonly number[];
  /** Live sessions whose bridge cannot be TOLD its session — muse and cursor — as id -> the pid of
   *  the pty this server spawned for it. */
  resolvableSessions: ReadonlyMap<string, number>;
}

/**
 * The session a bridge belongs to, or null when it cannot be shown to belong to any.
 *
 * Null is a real answer and the important one: the bridge then serves NO tools, rather than some
 * other session's. Every path here is a proof of DESCENT — this process runs under that session's
 * pane, or under its pty — so a muse nobody here started can never claim one. A missing chart is a
 * failure the user can see and report; a chart drawn in the wrong cell is not.
 */
export function resolveBridgeSession(facts: BridgeSessionFacts): string | null {
  const ptyOwners = new Map([...facts.resolvableSessions].map(([id, pid]) => [pid, id]));
  for (const pid of facts.ancestors) {
    const pane = facts.panePids.get(pid);
    if (pane && facts.resolvableSessions.has(pane)) return pane;
    const pty = ptyOwners.get(pid);
    if (pty) return pty;
  }
  return null;
}

// ── the groups half ───────────────────────────────────────────────────────────────────────────
//
// Once the session is known, what may it reach? For agy and grok that question is already answered
// by the file the agent read; muse's plugin is installed for the MACHINE and declares every group,
// so the answer has to come from here — recorded at spawn, when the directory's registration was
// read, and read back by the resolve route. Cursor's file answers it too, and it records here as
// well: the file is shared by every session in the directory, so it cannot narrow a session that
// started before a switch flipped, and the resolve route is the only thing that knows WHICH
// session is asking.
//
// In memory only, and deliberately: it describes a RUNNING session, so a server restart that
// forgets it has also lost the pty it describes. The entry is dropped when the session ends.
const groupsBySession = new Map<string, readonly ToolGroup[]>();

export function rememberEntitledToolGroups(sessionId: string, groups: readonly ToolGroup[]): void {
  groupsBySession.set(sessionId, [...groups]);
}

export function forgetEntitledToolGroups(sessionId: string): void {
  groupsBySession.delete(sessionId);
}

/** What this session may reach. Named for ENTITLEMENT, not to be confused with registry's
 *  `sessionToolGroups`, which records what a session has been OBSERVED reaching — that one is
 *  learned from connections and drives the Canvas gate; this one is decided at spawn and drives
 *  what a bridge is allowed to serve.
 *
 *  An unknown session answers NOTHING rather than everything: a bridge asking about a session we
 *  have no record of is a bridge we cannot vouch for. */
export const entitledToolGroups = (sessionId: string): readonly ToolGroup[] => groupsBySession.get(sessionId) ?? [];

/** The live sessions a bridge may resolve itself into, and the pty pid behind each — the world the
 *  rule above is applied to.
 *
 *  A CLOSED list, and it is the reason this is not simply "every live session": the other hosts are
 *  TOLD their session, and a process tree is a weaker claim than being told — so a bridge that lost
 *  its environment must not be able to claim a claude session by standing near it. An agent joins
 *  this list only once it is shown that its MCP child cannot inherit anything (muse's curated
 *  plugin environment, cursor's curated server environment), which is a measurement, not a guess. */
const BRIDGE_RESOLVABLE_AGENTS: readonly SessionAgent[] = ["muse", "cursor"];

export function bridgeResolvableSessions(): Map<string, number> {
  const sessions = new Map<string, number>();
  for (const [id, entry] of ptys) if (BRIDGE_RESOLVABLE_AGENTS.includes(entry.agent)) sessions.set(id, entry.term.pid);
  return sessions;
}
