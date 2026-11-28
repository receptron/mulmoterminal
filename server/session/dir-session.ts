// The ONE session a directory stands for, and whether anyone is holding it.
//
// For a worktree that is the whole model: a worktree is tied to a branch, so a second agent in it
// is not isolation — it is two agents editing one working tree. The launcher therefore offers a
// worktree row as exactly one of three things (start / resume / refuse), and all three need a
// single answer per directory rather than a list to choose from (#1207).

import path from "node:path";
import { canonicalPath } from "../infra/fs/canonical-path.js";
import { isSessionAttached, type SessionOccupancy } from "../../common/sessionOccupancy.js";
import type { SessionRunning } from "../../common/sessionRunning.js";
import { tmuxListSessionIds } from "../infra/process/tmux.js";
import { isTerminalAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { isProbeSessionId } from "../agents/probe/probe-session.js";
import type { AgentConversation } from "./list/agent-conversations.js";
import { grokConversationExists, grokSessionsRoot } from "../agents/grok/grok-session.js";
import {
  antigravityConversations,
  codexRollouts,
  isBackgroundSession,
  museConversations,
  ptys,
  refreshAgentConversations,
  translationWorkerIds,
} from "./registry.js";
import { claudeDiskStats, safeReaddir } from "./session-reads.js";

export interface DirSession extends SessionOccupancy {
  id: string;
  /** Which agent it is, so a row resumes as that one rather than as the cell's current pick. */
  agent: TerminalAgent;
}

export interface DirSessionCandidate extends DirSession {
  /** A pty for this session is alive in this process. */
  live: boolean;
  /** The transcript's mtime, or the moment of the read for a session yet to write one. */
  mtime: number;
}

// Held beats live beats merely recent. The held one is what a second terminal would collide with,
// so it has to be the one the row reports even when an older conversation in the same directory
// was written to more recently.
function rank(c: DirSessionCandidate): number {
  if (c.attached) return 2;
  return c.live ? 1 : 0;
}

const beats = (c: DirSessionCandidate, best: DirSessionCandidate): boolean => rank(c) > rank(best) || (rank(c) === rank(best) && c.mtime > best.mtime);

/** Pure so the precedence above can be pinned: it is the difference between refusing a directory
 *  someone is working in and handing that person's terminal to a second cell. */
export function pickDirSession(candidates: readonly DirSessionCandidate[]): DirSession | null {
  const best = candidates.reduce<DirSessionCandidate | null>((won, c) => (won === null || beats(c, won) ? c : won), null);
  return best === null ? null : { id: best.id, attached: best.attached, agent: best.agent };
}

// Internal helpers write their transcripts into the same project directory as the user's own
// chats, and one of them can easily be the most recent thing there. Offering to resume a rate-limit
// probe as "the worktree's session" is the failure this excludes.
const isUserSession = (id: string): boolean => !isProbeSessionId(id) && !translationWorkerIds.has(id) && !isBackgroundSession(id);

/** Whether anything is holding this session: a socket in this process, or a tmux client belonging
 *  to another one. `tmuxCounts` comes from a single `tmuxAttachedCounts()` per list. */
export function sessionAttached(id: string, tmuxCounts: Map<string, number> | null): boolean {
  const entry = ptys.get(id);
  return isSessionAttached({
    viewedHere: !!entry?.ws && entry.ws.readyState === entry.ws.OPEN,
    tmuxClients: tmuxCounts === null ? null : (tmuxCounts.get(id) ?? 0),
    holdsTmuxClient: !!entry?.tmux,
  });
}

/** Every session key something is actually RUNNING under: a tmux session that survived, or a pty in
 *  this process (which is all there is when tmux is absent — then nothing outlives a restart).
 *
 *  A separate tmux call from `tmuxAttachedCounts`, because the two answer different questions and
 *  `list-clients` cannot answer this one: it reports only sessions that HAVE a client, so a session
 *  running with nobody attached — the one that piles up unseen across restarts — is missing from it
 *  entirely (#1467). One call per list, like the other. */
export function runningSessionKeys(): Set<string> {
  return new Set<string>([...tmuxListSessionIds(), ...ptys.keys()]);
}

/**
 * The running-key snapshot a survivor match needs, taken in the only safe order: the shared
 * conversation logs are refreshed FIRST, then the keys are read — so a tmux session another
 * MulmoTerminal process created during the refresh is in `running` with its mapping already
 * folded in. The other order left a window the length of the refresh in which such a session had
 * a mapping but no running key, and its worktree read as free (#1534 review).
 *
 * One call per LIST, like `tmuxAttachedCounts`: this is what callers hand `dirSession` and
 * `runningKeyOf` as `running` — reading `runningSessionKeys()` directly is only for a caller
 * that consults no conversation log.
 */
export async function survivorSnapshot(): Promise<Set<string>> {
  await refreshAgentConversations();
  return runningSessionKeys();
}

/** Which of a row's possible keys is the one actually running, or null.
 *
 *  `keys` is the row's own id FIRST, then the session keys its agent's conversation log maps it to
 *  — a codex/agy conversation started from a grid cell runs under a key MulmoTerminal minted, and
 *  the id the row is drawn from would kill nothing. Pure, because it is the half that decides what
 *  a stop button is aimed at. */
export const runningKeyOf = (keys: readonly string[], running: ReadonlySet<string>): string | null => keys.find((key) => running.has(key)) ?? null;

/** The two facts a Claude list row carries about who holds and what runs it, for one id. The list
 *  rows and the single-id occupancy route both build them here, so the two cannot disagree. */
export const sessionOccupancyOf = (id: string, tmuxCounts: Map<string, number> | null, running: ReadonlySet<string>): SessionOccupancy & SessionRunning => ({
  attached: sessionAttached(id, tmuxCounts),
  runningKey: runningKeyOf([id], running),
});

// A plain shell parked in a worktree is deliberately NOT the worktree's session: it is a terminal
// someone opened, not an agent editing the tree, and refusing the worktree on the strength of one
// would be a lock nobody can see the reason for.
// Matched on the CANONICAL path, not a resolved string: a session started through a symlinked
// spelling of the same worktree would otherwise not be found here, and once its socket closed
// nothing would report the worktree as occupied — least of all for codex or antigravity, which
// have no transcript pass below to fall back on (#1208, found by Codex). Same canonicalization
// `isManagedWorktree` uses to decide the directory is a worktree in the first place.
function livePtyCandidates(dir: string, tmuxCounts: Map<string, number> | null, now: number): DirSessionCandidate[] {
  return [...ptys.entries()].flatMap(([id, entry]) => {
    if (!isUserSession(id) || !isTerminalAgent(entry.agent) || canonicalPath(entry.cwd) !== dir) return [];
    return [{ id, live: true, mtime: now, agent: entry.agent, attached: sessionAttached(id, tmuxCounts) }];
  });
}

/** One agent's conversation log, as the survivor pass below reads it: which agent, and its
 *  session-key → conversation records. */
export interface SurvivorLog {
  agent: TerminalAgent;
  records: Iterable<readonly [string, AgentConversation]>;
}

/**
 * Sessions still RUNNING in tmux that `ptys` no longer knows: the pty died while the session kept
 * going (#1496 keeps the session and drops the entry), or the server restarted under it. The live
 * pass above cannot see them, and for codex/agy/muse no transcript pass can either — their
 * conversations live under the agent's own root keyed by its own id, so the conversation log is
 * the one record tying the surviving key to a directory.
 *
 * Before this pass such a session read as "no session here": the worktree admitted a second agent
 * beside a running one, and the launcher's row offered its conversation as free — which is how one
 * conversation ended up with two backends and the view came back on the wrong one (#1533).
 *
 * Pure over its inputs so the selection can be pinned; `dirSession` wires the real registry in.
 */
export function survivorCandidates(
  dir: string,
  logs: readonly SurvivorLog[],
  facts: {
    running: ReadonlySet<string>;
    /** A pty in this process — the live pass already names it, better (its cwd is current). */
    liveHere: (id: string) => boolean;
    userSession: (id: string) => boolean;
    attached: (id: string) => boolean;
    now: number;
  },
): DirSessionCandidate[] {
  return logs.flatMap(({ agent, records }) =>
    [...records].flatMap(([id, record]) => {
      if (!facts.running.has(id) || facts.liveHere(id) || !facts.userSession(id)) return [];
      // The cwd recorded when the conversation was claimed, canonicalized like the live pass: a
      // worktree reached through a symlinked spelling is still the same directory (#1208).
      if (canonicalPath(record.cwd) !== dir) return [];
      return [{ id, live: true, mtime: facts.now, agent, attached: facts.attached(id) }];
    }),
  );
}

// Claude's transcripts are the only agent conversation discoverable from a DIRECTORY: codex keeps
// its rollouts under ~/.codex keyed by its own id, so a codex session that outlived its pty is
// found by the live pass above, the survivor pass, or not at all.
//
// `running` upgrades a transcript whose session survives in tmux to a LIVE candidate: rank decides
// between "the conversation running right now" and "the one written to most recently", and those
// are different sessions exactly when a restart left one running (#1533).
async function transcriptCandidates(dir: string, tmuxCounts: Map<string, number> | null, running: ReadonlySet<string>): Promise<DirSessionCandidate[]> {
  const stats = await claudeDiskStats(dir, (sessionsDir) => safeReaddir(sessionsDir).filter((f) => f.endsWith(".jsonl")));
  return stats
    .filter((s) => isUserSession(s.id))
    .map((s) => ({ id: s.id, live: running.has(s.id), mtime: s.mtime, agent: "claude" as const, attached: sessionAttached(s.id, tmuxCounts) }));
}

// BOTH spellings, because neither one alone is right (#1208). Claude names its project directory
// after the cwd it was handed, and this app hands over a LEXICALLY resolved path on purpose
// (config/workspace.ts explains why it does not realpath) — so transcripts can sit under the
// caller's spelling. But the caller may equally arrive with git's canonical spelling of a worktree
// reached through a symlink, whose transcripts are under the other name. Looking under one name
// misses the session and lets a second start; looking under both cannot.
async function transcriptCandidatesEitherSpelling(
  dir: string,
  tmuxCounts: Map<string, number> | null,
  running: ReadonlySet<string>,
): Promise<DirSessionCandidate[]> {
  const spellings = [...new Set([path.resolve(dir), canonicalPath(dir)])];
  const found = await Promise.all(spellings.map((spelling) => transcriptCandidates(spelling, tmuxCounts, running)));
  // Deduped by id: one session listed twice would be picked as itself either way, but a duplicate
  // is a fact about the LOOKUP rather than about the directory, and nothing downstream should have
  // to know that.
  return [...new Map(found.flat().map((candidate) => [candidate.id, candidate])).values()];
}

/**
 * grok's survivors, by PROBE rather than log: grok keeps no conversation log to consult — the
 * session key IS grok's own conversation id, and its store is partitioned by directory — so a
 * surviving key is tied to a directory by asking the store whether that conversation exists there.
 * Without this pass a grok session that outlived its pty read as "no session here", and the
 * worktree admitted a second agent beside it (#1534 review). Pure over `conversationInDir` so the
 * selection can be pinned.
 */
export function grokSurvivorCandidates(facts: {
  running: ReadonlySet<string>;
  liveHere: (id: string) => boolean;
  userSession: (id: string) => boolean;
  attached: (id: string) => boolean;
  conversationInDir: (id: string) => boolean;
  now: number;
}): DirSessionCandidate[] {
  return [...facts.running].flatMap((id) => {
    if (facts.liveHere(id) || !facts.userSession(id) || !facts.conversationInDir(id)) return [];
    return [{ id, live: true, mtime: facts.now, agent: "grok" as const, attached: facts.attached(id) }];
  });
}

/** `tmuxCounts`, `running` and `now` are passed in so a whole list of directories is answered from
 *  one `list-clients` call, one `list-sessions` call and one clock read — `survivorSnapshot()` is
 *  the value callers hand over as `running`, because it also refreshes the conversation logs the
 *  survivor pass below matches against, in the only order that cannot miss a session (see its
 *  header). */
export async function dirSession(dir: string, tmuxCounts: Map<string, number> | null, now: number, running: ReadonlySet<string>): Promise<DirSession | null> {
  const canonical = canonicalPath(dir);
  const live = livePtyCandidates(canonical, tmuxCounts, now);
  const liveHere = (id: string): boolean => ptys.has(id);
  const attached = (id: string): boolean => sessionAttached(id, tmuxCounts);
  const survivors = survivorCandidates(
    canonical,
    [
      { agent: "codex", records: codexRollouts },
      { agent: "antigravity", records: antigravityConversations },
      { agent: "muse", records: museConversations },
    ],
    { running, liveHere, userSession: isUserSession, attached, now },
  );
  // Both spellings for the probe, like the transcript pass: grok records the cwd spelling the
  // session was handed, and a worktree reached through a symlink is still the same directory.
  const spellings = [...new Set([path.resolve(dir), canonical])];
  const grokSurvivors = grokSurvivorCandidates({
    running,
    liveHere,
    userSession: isUserSession,
    attached,
    conversationInDir: (id) => spellings.some((spelling) => grokConversationExists(grokSessionsRoot(), spelling, id)),
    now,
  });
  return pickDirSession([...live, ...survivors, ...grokSurvivors, ...(await transcriptCandidatesEitherSpelling(dir, tmuxCounts, running))]);
}
