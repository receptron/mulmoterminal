// Per-session state every layer reads: the routes answering /api/sessions, the WebSocket
// handlers, the Claude hooks, and the PTY spawns all reach for the same tables. They lived
// in index.ts, which is why nothing else could be split out of it (#548) — a table here can
// be imported without importing the boot module.
//
// The maps are exported directly, not behind accessors: every call site already reads and
// writes them as maps, and wrapping ~150 of those in getters would be churn with no invariant
// to enforce. What DOES belong here is the persistence, because "what is on disk" and "what
// is in memory" have to agree.
import { promises as fs } from "node:fs";
import path from "node:path";
import { MULMOTERMINAL_HOME, SESSION_ID_RE } from "../config/env.js";
import type { DirModelChoice } from "./provider-env.js";
import { asTerminalAgent, type SessionAgent, type TerminalAgent } from "../../common/sessionAgent.js";
import { messageOf } from "../errors.js";
import { buildActivitySnapshot, mergeOwnedActivity, parseActivityState, type PersistedActivity } from "./activity-state.js";
import { parseSessionIdLog, sessionIdLogLine } from "./session-id-log.js";
import { applyCustomAgentSession, customAgentSessionLine, customAgentSessionRecord } from "./custom-agent-log.js";
import { isCustomAgentId } from "../../common/customAgents.js";
import {
  agentConversationLine,
  agentConversationRecord,
  applyAgentConversation,
  hydrateAgentConversationInto,
  type AgentConversation,
} from "./agent-conversations.js";
import { applySessionMemo, createMemoWriteGuard, sessionMemoLine, sessionMemoRecord } from "./session-memos.js";
import { normalizeMemo } from "../../common/sessionMemo.js";
import { forEachJsonlRecord } from "../infra/jsonl-file.js";
import { devTerminalCwdLine, hydrateCwdsInto } from "./dev-terminal-cwds.js";
import { parseSessionToolGroups, sessionToolGroupLine, TOOL_GROUP_RESET, type SessionToolGroup } from "./session-tool-groups.js";
import { allToolsLogLine, parseAllToolsLog } from "./all-tools-log.js";
import type { ToolGroup } from "../../common/toolGroups.js";
import { carriesFullGuiMcp } from "./mcp-config.js";
import type { Activity, KnownSession, PtyEntry } from "./types.js";

// Per-session "working" state, driven by Claude hooks (see /api/hook):
// UserPromptSubmit => Claude started thinking; Stop => it finished.
export const activity = new Map<string, Activity>(); // id -> { working, event, at }

// Live ptys keyed by session id. A pty outlives its WebSocket while the session
// is still "working", so switching away doesn't interrupt Claude mid-turn; it
// is reaped once the session goes idle (Stop hook) or the process exits. `ws`
// is null while the session runs in the background.
export const ptys = new Map<string, PtyEntry>(); // id -> { term, ws, buffer }

// New sessions started in this process that have no .jsonl on disk yet (Claude
// only writes the file on the first prompt). Merged into /api/sessions so a
// freshly created session shows in the sidebar immediately. An entry is dropped
// once the file exists (the on-disk record takes over) or the pty is reaped.
export const knownSessions = new Map<string, KnownSession>(); // id -> { createdAt, title }

// What each session was STARTED on, when the launch form picked it rather than the
// directory (#584). Read back on resume: the browser re-sends its cell's pick on every
// reconnect, and that value belongs to the session the cell launched, not necessarily to
// the one being resumed. Process-lifetime only — after a restart a resumed session falls
// back to the directory's default, same as one this server never started.
export const launchChoices = new Map<string, DirModelChoice>(); // id -> { provider, model }

// Which CUSTOM AGENT each session was started on (#1414) — the Agent Picker's equivalent of
// `launchChoices` above, remembered because a resume must continue on the agent the session began
// on rather than on whatever the picker currently shows.
//
// Unlike the choices, it is PERSISTED and survives reap: see custom-agent-log.ts. A transcript
// outlives its pty, and the id is the only thing standing between resuming that conversation and
// silently continuing it on a different model. Declared here; hydrated further down, next to the
// other logs.
export const customAgentSessions = new Map<string, string>(); // session id -> custom agent id

// Sessions spawned as hidden background workers (spawnBackgroundChat hidden:true) that are
// still LIVE. Process-lifetime only, and tied to `activity`'s lifecycle in reap(). Ask
// `isBackgroundSession()` rather than this set when the question is "does this row belong
// behind the Background filter" — that survives the reap and a restart; this does not.
export const hiddenSessions = new Set<string>(); // id

// Latest MEANINGFUL user prompt per session (from the UserPromptSubmit hook), shown
// on the grid cell header so you can tell at a glance what each terminal is about. A
// trivial ack ("ok", "merge") doesn't replace it (see the hook handler), so a short
// follow-up can't hide the task.
export const lastPrompts = new Map<string, string>(); // id -> prompt text

// The session id CLAUDE currently calls itself, for a session this app knows by ITS id. The two
// start equal (the spawn passes `--session-id`) and, per cleared-transcripts.ts, diverge at a
// `/clear`, where claude mints a new one and keeps reporting to us under ours
// (resolveHookSessionId). Anything keyed by CLAUDE's id needs this — its prompt-history file is
// the one (#1749); everything of ours stays on our id.
//
// NOT a chain, and `/compact` is not on that list: measured over the 95 compacted transcripts on
// this machine, the 61 that had prompts afterwards ALL kept the same id. See historyIdsFor.
//
// In memory, and re-learned from the next hook of any kind — cheap, since in practice it equals
// our own id. Persisting it would outlive the process that could tell whether it is still true.
export const claudeSessionIds = new Map<string, string>(); // our id -> claude's current session id

// AI header title per session (issue #316): a short summary of the recent turns that
// stays meaningful when the session turns into a back-and-forth, where the raw last
// prompt goes stale ("ok") or context-dependent ("2番目にして"). Generated by a cheap
// model, it takes precedence over lastPrompt in the cell header. Kept in memory (never
// written into Claude's transcript); a resumed session falls back to any on-disk title.
export const aiTitles = new Map<string, string>(); // id -> AI title

// the last few lines of the agent's most recent reply, refreshed when
// a turn ends (waiting), so the roster can show "what it just said" without the terminal open.
export const lastResponses = new Map<string, string>(); // id -> last assistant text (truncated)

export const titleTurnCounts = new Map<string, number>(); // id -> user turns since last title
export const titlePending = new Set<string>(); // ids whose next Stop should (re)generate a title
export const titleInFlight = new Set<string>(); // ids currently generating, to avoid overlap
export const titleEpoch = new Map<string, number>(); // bumped on /clear or teardown to void an in-flight generation
// The transcript's user-turn count when we last titled a session, so the roster's view-triggered
// re-titling knows when a session has advanced enough to be worth re-summarizing. Kept across
// /clear (dropped only on teardown) so a just-cleared session isn't re-titled from its frozen
// pre-clear transcript.
export const lastTitledUserTurns = new Map<string, number>();
// Wall-clock of the last view-triggered title attempt per session, so a session whose generation
// keeps failing backs off instead of re-spawning the summarizer on every 4s roster poll.
export const lastTitleAttemptMs = new Map<string, number>();

// Rollout files already attributed to a session, so a single rollout is never mapped to two keys
// (which would let both cold-resume the same conversation). Serialized by the single event loop.
export const claimedCodexRollouts = new Set<string>();

// Sessions spawned with our `--settings` hooks, i.e. the ones that report their own tool calls to
// /api/hook. Only spawn-claude registers them, because only claude has a hook mechanism.
//
// It exists so the MCP broker can tell whether a session's tool calls are ALREADY being recorded,
// without asking what agent it is: a codex launcher chip runs codex through the login shell, so
// its PtyEntry is honestly labelled "shell" and no agent name identifies it (see
// mcp/gui-call-history.ts). What the broker actually needs to know is this, not the name.
//
// Never pruned. An id is a v4 uuid used once, the set costs a string per session, and forgetting
// one would silently start double-recording that session's GUI calls — the opposite of cheap.
export const hookedSessions = new Set<string>();

// Conversation directories already attributed to a session, so one is never mapped to two keys
// (which would let both cold-resume the same conversation). The session -> conversation mapping
// itself is persisted; see `antigravityConversations` below.
export const claimedAntigravityConversations = new Set<string>();

// Hidden translation-worker sessions run in CLAUDE_CWD — the workspace the user has
// already trusted — because claude blocks on its workspace-trust dialog in any
// untrusted dir (no input ever comes, so the worker would hang). Their session ids
// are tracked here so they're FILTERED OUT of /api/sessions: a translation worker is
// a transient internal helper, not a chat the user should see in the sidebar.
export const translationWorkerIds = new Set<string>();

const isValidSessionId = (id: string) => SESSION_ID_RE.test(id);

// Hydrate one id log once at boot (best-effort — absent on first run / unreadable => empty).
// Exposed as a promise so readers/writers can wait for it: a request served (or a mark
// persisted) before this resolves would otherwise see an empty set and either leak the
// sessions the log exists to keep out or clobber the file with a snapshot missing the
// on-disk ids.
function hydrateIdLog(file: string, into: Set<string>): Promise<void> {
  return (async () => {
    try {
      for (const id of parseSessionIdLog(await fs.readFile(file, "utf8"), isValidSessionId)) into.add(id);
    } catch {
      // absent on first run / unreadable => nothing remembered
    }
  })();
}

// Appended, never rewritten: another instance shares these files, and a read-merge-write
// loses whichever of the two finishes first however small the window is made. An append
// needs no read, and nothing here is ever removed. Each log gets its own chain so its
// writes stay ordered and a failure is logged without stopping the next one.
function idLogAppender(file: string, label: string): (id: string) => void {
  let persist: Promise<void> = Promise.resolve();
  return (id: string) => {
    persist = persist
      .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
      .then(() => fs.appendFile(file, sessionIdLogLine(id)))
      .catch((e) => console.error(`[${label}] failed to persist: ${messageOf(e)}`));
  };
}

// Session ids that belong to the multi-terminal GRID — dev terminals, spawned with
// gui=0 (no GUI MCP; see the ?gui handling in the WS connection handler). They're
// FILTERED OUT of the chat sidebar's /api/sessions so a grid terminal never surfaces
// as a clickable chat row: selecting it in chat would reattach its live PTY and
// SUPERSEDE the grid cell (the "chat hijacked my multi-terminal session" bug). The
// set is persisted so the exclusion survives a reboot and outlives the live PTY — a
// reaped grid session's on-disk transcript still shouldn't reappear as a chat. NOTE:
// the exclusion applies ONLY to the unscoped (chat) query; the grid's OWN cwd-scoped
// resume picker (/api/sessions?cwd=…) must keep listing these so they stay resumable.
export const devTerminalSessions = new Set<string>();
const DEV_TERMINAL_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "dev-terminal-sessions.json");
export const devTerminalSessionsHydrated = hydrateIdLog(DEV_TERMINAL_SESSIONS_FILE, devTerminalSessions);
const appendDevTerminalSession = idLogAppender(DEV_TERMINAL_SESSIONS_FILE, "dev-terminal-sessions");

// Record a grid/dev-terminal session id, then persist. A no-op once the id is known,
// so repeated reattaches of the same cell — or a reconnect after a reboot — don't
// rewrite the file.
export function markDevTerminalSession(id: string, cwd?: string): void {
  // The cwd is recorded even for an id we already knew: this is the one place that sees a cell's
  // directory, and a session relaunched somewhere else must not keep answering with the old one.
  if (SESSION_ID_RE.test(id) && cwd) rememberSessionCwd(id, cwd);
  if (!SESSION_ID_RE.test(id) || devTerminalSessions.has(id)) return;
  devTerminalSessions.add(id);
  appendDevTerminalSession(id);
}

// Session ids spawned as background workers: the scheduled collection refresh, and any
// `spawnBackgroundChat hidden:true`. The chat list keeps them, but behind the Background
// filter rather than among the user's own chats (#1060).
//
// Persisted for the same reason the grid's set is: `hiddenSessions` is dropped on reap and
// gone after a restart, so a live-only flag would put every finished worker BACK among the
// chats the moment it completed — the one state the user is guaranteed to see it in.
const backgroundSessions = new Set<string>();
const BACKGROUND_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "background-sessions.json");
export const backgroundSessionsHydrated = hydrateIdLog(BACKGROUND_SESSIONS_FILE, backgroundSessions);
const appendBackgroundSession = idLogAppender(BACKGROUND_SESSIONS_FILE, "background-sessions");

function markBackgroundSession(id: string): void {
  if (!isValidSessionId(id) || backgroundSessions.has(id)) return;
  backgroundSessions.add(id);
  appendBackgroundSession(id);
}

/** Does this session belong behind the Background filter? Live workers answer from
 *  `hiddenSessions`, everything else from the persisted log — a session that has been
 *  background once stays background. */
export function isBackgroundSession(id: string): boolean {
  return hiddenSessions.has(id) || backgroundSessions.has(id);
}

// Visible sessions the SERVER spawned that no grid cell has taken yet.
//
// A chat started from the collections UI is placed by the browser that asked for it, which covers
// the common case and only that case: an agent calling spawnBackgroundChat, a scheduled task, or
// the phone can all start a visible chat while no tab is open at all — and once the single view is
// gone there is nowhere for such a session to appear. This is the durable half: the server
// remembers that one is waiting, and the next grid to load adopts it.
//
// UNPLACED is the whole meaning, so the mark is cleared the moment a grid cell attaches (see
// ws-routes, the one choke point for every grid attach). That keeps it server-side state with one
// writer, rather than a dismissed-set growing in each tab — and it is why a browser-placed chat
// does not come back as a second cell on the next load.
//
// Persisted because the case it exists for is precisely "nobody was looking": a mark held only in
// memory would be lost by the restart that happens before anyone opens a tab.
// `<session id> <agent>` per line, because the ID ALONE is not enough to reconnect. A cell adopting
// a codex session over claude's endpoint attaches to the wrong agent, and the live PtyEntry that
// would have said so is exactly what is gone in the case this exists for — the server restarted,
// or the pty was reaped, before anyone opened a tab (Codex, PR #1189).
const unplacedSessions = new Map<string, TerminalAgent>();
const UNPLACED_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "unplaced-sessions.json");
export const unplacedSessionsHydrated = (async () => {
  try {
    const contents = await fs.readFile(UNPLACED_SESSIONS_FILE, "utf8");
    for (const line of contents.split("\n")) {
      const [id, agent] = line.trim().split(/\s+/);
      // A line with no agent is one written before this field existed; claude is what those were.
      if (id && isValidSessionId(id)) unplacedSessions.set(id, asTerminalAgent(agent));
    }
  } catch {
    // absent on first run / unreadable => nothing waiting
  }
})();
let unplacedPersist: Promise<void> = Promise.resolve();
function appendUnplacedSession(id: string, agent: TerminalAgent): void {
  unplacedPersist = unplacedPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(UNPLACED_SESSIONS_FILE, `\n${id} ${agent}`))
    .catch((e) => console.error(`[unplaced-sessions] failed to persist: ${messageOf(e)}`));
}
// Ids whose mark has been cleared this process. The log is append-only (MULMOTERMINAL_HOME is
// shared between server instances, so a read-merge-write loses one of them), and hydration reads
// it as it was BEFORE a clear could be appended — so without this a session adopted during startup
// would be handed back as unplaced.
const placedSessions = new Set<string>();

/** Note that the server spawned a VISIBLE session nobody has a cell for yet. The agent travels
 *  with the id for the same reason it does everywhere else: the cell has to reconnect on the right
 *  endpoint, and by the time this is read the running process may be gone. */
export function markUnplacedSession(id: string, agent: TerminalAgent = "claude"): void {
  if (!isValidSessionId(id) || unplacedSessions.has(id)) return;
  unplacedSessions.set(id, agent);
  appendUnplacedSession(id, agent);
}

/** A grid cell has taken this session — or the user closed it. Either way it is no longer waiting
 *  for a home, and must not be adopted again on the next load. */
export function markSessionPlaced(id: string): void {
  if (!isValidSessionId(id)) return;
  unplacedSessions.delete(id);
  // A no-op once known, like every other mark in this file — and here it is not just tidiness.
  // This runs at ALL FOUR ws attach points, so a long-lived session reconnecting (a reload, a
  // network blip, a page switch in the grid) would otherwise append a line every time: the log
  // would grow with ATTACH count rather than session count, and /api/sessions/unplaced waits on
  // hydrating it (Codex, PR #1189).
  if (placedSessions.has(id)) return;
  placedSessions.add(id);
  appendPlacedSession(id);
}
const PLACED_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "placed-sessions.json");
export const placedSessionsHydrated = hydrateIdLog(PLACED_SESSIONS_FILE, placedSessions);
const appendPlacedSession = idLogAppender(PLACED_SESSIONS_FILE, "placed-sessions");

/**
 * A viewer now has this session, so it stops waiting for a home (see the unplaced marker).
 *
 * BOTH ids. The resolvers mint a FRESH one when the requested session can be served neither from a
 * live pty nor from a transcript — a spawn that died before writing one, which is exactly the kind
 * that ends up unplaced. Clearing only the new id would leave the requested one marked forever, so
 * every activate would adopt it again and mint another session, accumulating cells (Codex, #1189).
 *
 * Cleared for ANY attach, not only a grid one: "unplaced" means nobody is looking, and a viewer is
 * a viewer.
 */
export function markAttachedSessionPlaced(sessionId: string, requested: string | null): void {
  markSessionPlaced(sessionId);
  if (requested && requested !== sessionId) markSessionPlaced(requested);
}

/** The sessions a loading grid should adopt: spawned visible by the server, never taken. */
export function unplacedSessionRows(): { id: string; agent: TerminalAgent }[] {
  return [...unplacedSessions].filter(([id]) => !placedSessions.has(id)).map(([id, agent]) => ({ id, agent }));
}

/** Whether the phone may list this session: a grid cell, or one on its way to being one.
 *
 *  The two halves are one question asked at two moments. `devTerminalSessions` is written by a
 *  browser attach and by nothing else, so a session the PHONE started — the issue it just began,
 *  the chat it just sent — is in neither set the desktop reads, and the phone would not find in
 *  its own list the work it had started (#1184). The unplaced mark is exactly "spawned visible,
 *  no cell yet", and it is cleared by the attach that adds the id to the other set, so a session
 *  moves between the halves without ever being in both or in neither. */
export function isPhoneListableSession(id: string): boolean {
  return devTerminalSessions.has(id) || (unplacedSessions.has(id) && !placedSessions.has(id));
}

// Sessions handed the ALL-TOOLS MCP url (`/api/mcp/:sessionId`). That url comes from --mcp-config
// and from nothing else, so it means the session carries the whole GUI MCP — including the tools
// that belong to no group and are therefore unreachable through a group url (spawnBackgroundChat).
//
// Written at TWO moments, and the earlier one is what a decision can rely on. Connecting proves it
// (below), but a group url may be the first to connect, and it has to know the answer already to
// stand down (#1338) — so `claimFullGuiMcp` records it at spawn, before either client dials.
//
// Recorded as its own fact rather than inferred from "has all four groups", which is a different
// statement: a directory that registered every group url really does have all four groups and
// really does NOT have the ungrouped tools.
//
// Persisted for the same reason the tool-group log is: the learning happens in memory, and a
// server restart would forget it while the claude process keeps running in tmux, already past
// the ListTools that would teach us again.
const allToolsSessions = new Set<string>();
const ALL_TOOLS_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "all-tools-sessions.json");
export const allToolsSessionsHydrated = (async () => {
  try {
    for (const id of parseAllToolsLog(await fs.readFile(ALL_TOOLS_SESSIONS_FILE, "utf8"), isValidSessionId)) allToolsSessions.add(id);
  } catch {
    // absent on first run / unreadable => nothing remembered
  }
})();
let allToolsPersist: Promise<void> = Promise.resolve();
function appendAllToolsEntry(id: string, carries: boolean): void {
  allToolsPersist = allToolsPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(ALL_TOOLS_SESSIONS_FILE, allToolsLogLine(id, carries)))
    .catch((e) => console.error(`[all-tools-sessions] failed to persist: ${messageOf(e)}`));
}
export const whenAllToolsPersisted = (): Promise<void> => allToolsPersist;

/** Note that a session reached us on the all-tools url. A no-op once known — one server is built
 *  per MCP request, so this is asked on every tool call. */
export function markAllToolsSession(id: string): void {
  if (!isValidSessionId(id) || allToolsSessions.has(id)) return;
  allToolsSessions.add(id);
  appendAllToolsEntry(id, true);
}

/**
 * The opposite, and the reason this log needed a release marker at all: a session id outlives the
 * process that earned the claim. A new process given no all-tools url must stop answering yes, or
 * its group urls stand down (mcp/tool-gate.ts) with nothing left to serve the tools — a cell with
 * no GUI tools at all, which is worse than the duplicate the standing-down prevents.
 *
 * Called only where a genuinely NEW process is starting, never on a tmux reattach: there the
 * original process is still running with whatever url it was given.
 */
export function releaseAllToolsSession(id: string): void {
  if (!isValidSessionId(id) || !allToolsSessions.has(id)) return;
  allToolsSessions.delete(id);
  appendAllToolsEntry(id, false);
}

/** Does this session carry the whole GUI MCP, rather than the subset its directory registered? */
export function hasAllGuiTools(id: string): boolean {
  return allToolsSessions.has(id);
}

/**
 * Decide whether a spawn carries the full GUI MCP AND bring the record in line, in one call.
 *
 * Every spawn path asks `carriesFullGuiMcp` — claude's argv, codex's `-c` overrides, the launcher
 * chip — and each then hands out the all-tools url, or does not. Keeping the question and the record
 * apart is how one of them comes to answer differently from what it handed over, which is the drift
 * CLAUDE.md warns about around this predicate and is what happened twice in review on #1399: a chip
 * running `zsh` claimed without being handed anything, and codex claimed without ever releasing.
 * So spawn paths call THIS; the pure predicate stays exported for the specs and for readers.
 *
 * The two directions are NOT symmetric, and the asymmetry is the safety:
 *
 * - **Release unconditionally.** Releasing one that should have been kept only brings the duplicate
 *   tool names back — cosmetic, and the next spawn corrects it. Keeping a stale claim leaves a cell
 *   with its group urls stood down and no all-tools url to serve them: no GUI tools at all.
 * - **Claim only for a genuinely new process.** A tmux reattach runs whatever the ORIGINAL spawn was
 *   given, which may be no all-tools url — claiming on top of that is exactly the stale-claim
 *   failure, arrived at from the other side.
 */
export function claimFullGuiMcp(sessionId: string, attachGuiMcp: boolean, cwd: string | undefined, wouldReattach: boolean, agent: SessionAgent): boolean {
  const full = carriesFullGuiMcp(attachGuiMcp, cwd, agent);
  if (!full) releaseAllToolsSession(sessionId);
  else if (!wouldReattach) markAllToolsSession(sessionId);
  return full;
}

// Sessions the SCHEDULER started — a user's own configured task, as opposed to a collection
// refresh or an internal helper.
//
// They are background sessions in every other respect (out of the chat list, never bold, no grid
// cell), and this exists because ONE of those respects is wrong for them: a turn ending on a
// background session never reaches the phone, on the reasoning that it "isn't a real user task".
// A task the user configured to run while they are away is exactly a real user task, and push is
// the only way they would ever hear about it (Codex, PR #1196).
//
// Persisted like its siblings: a tmux session outlives a server restart, so the turn that raises
// the push can happen long after the process that spawned it is gone.
const userScheduledSessions = new Set<string>();
const USER_SCHEDULED_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "user-scheduled-sessions.json");
export const userScheduledSessionsHydrated = hydrateIdLog(USER_SCHEDULED_SESSIONS_FILE, userScheduledSessions);
const appendUserScheduledSession = idLogAppender(USER_SCHEDULED_SESSIONS_FILE, "user-scheduled-sessions");

export function markUserScheduledSession(id: string): void {
  if (!isValidSessionId(id) || userScheduledSessions.has(id)) return;
  userScheduledSessions.add(id);
  appendUserScheduledSession(id);
}

/** Did the scheduler start this? Asked by the push rules, which suppress background sessions. */
export function isUserScheduledSession(id: string): boolean {
  return userScheduledSessions.has(id);
}

/**
 * The two durable answers the Web Push gate needs, read TOGETHER and only once both logs have
 * hydrated.
 *
 * One function rather than two calls, because the HAZARD IS THE COMBINATION. Read separately
 * during startup, `background` can hydrate before `userScheduled` — and `(background: true,
 * userScheduled: false)` is precisely "a background session that is not the user's task", so the
 * push is suppressed for the one run that most needs it. A scheduled session survives a restart in
 * tmux, so its turn finishing moments after boot is the ordinary case here, not a corner (Codex,
 * PR #1196).
 */
export async function pushClassification(id: string): Promise<{ background: boolean; userScheduled: boolean }> {
  await Promise.all([backgroundSessionsHydrated, userScheduledSessionsHydrated]);
  return { background: isBackgroundSession(id), userScheduled: isUserScheduledSession(id) };
}

// Background workers whose run ENDED BADLY: reached teardown without ever reporting a finished
// turn. A worker is invisible on purpose, so a failed one is the single case where that design
// works against the user — nothing pulls their attention and nothing is waiting to be clicked, so
// without a record the failure is simply never learned.
//
// Persisted for the same reason the set above is, and more so: the whole value of this is being
// able to find out LATER. A live-only flag would be cleared by the very reap that discovers the
// failure.
const failedWorkers = new Set<string>();
const FAILED_WORKERS_FILE = path.join(MULMOTERMINAL_HOME, "failed-workers.json");
export const failedWorkersHydrated = hydrateIdLog(FAILED_WORKERS_FILE, failedWorkers);
const appendFailedWorker = idLogAppender(FAILED_WORKERS_FILE, "failed-workers");

/** Record that a background worker ended without succeeding. Only ever called for a session that
 *  is already a background one — a watched session's failure is visible in its own terminal. */
export function markFailedWorker(id: string): void {
  if (!isValidSessionId(id) || failedWorkers.has(id)) return;
  failedWorkers.add(id);
  appendFailedWorker(id);
}

/** Did this background worker end badly? Read per row by the session list, so a launcher can say
 *  so next to the worker rather than making the user open each one to find out. */
export function isFailedWorker(id: string): boolean {
  return failedWorkers.has(id);
}

/** What a hidden spawn marks itself with (see runWithHiddenMarker). Both halves of "hidden"
 *  are set from ONE place because there are two spawn sites, and a site that remembered the
 *  live flag but not the log would produce a worker that is background until it finishes and
 *  an ordinary chat afterwards. `delete` only undoes the live half: the log is append-only,
 *  and a spawn that threw never wrote a transcript, so its id never reaches a listing. */
export const backgroundMarkers = {
  add(id: string): void {
    hiddenSessions.add(id);
    markBackgroundSession(id);
  },
  delete(id: string): void {
    hiddenSessions.delete(id);
  },
};

// Where each grid session was started, for the sessions this process did not spawn (#1021). Live
// ones answer from `ptys`, which is the truer source — it knows where claude actually runs.
const sessionCwds = new Map<string, string>();
const DEV_TERMINAL_CWDS_FILE = path.join(MULMOTERMINAL_HOME, "dev-terminal-cwds.json");

export const devTerminalCwdsHydrated: Promise<void> = (async () => {
  try {
    hydrateCwdsInto(sessionCwds, await fs.readFile(DEV_TERMINAL_CWDS_FILE, "utf8"), isValidSessionId);
  } catch {
    // absent on first run, unreadable => nothing remembered; the list degrades to today's behaviour
  }
})();

/** The remembered directory for a session, or null. */
export function sessionCwd(id: string): string | null {
  return sessionCwds.get(id) ?? null;
}

let devTerminalCwdPersist: Promise<void> = Promise.resolve();
function rememberSessionCwd(id: string, cwd: string): void {
  if (sessionCwds.get(id) === cwd) return; // already the answer; appending would only grow the log
  sessionCwds.set(id, cwd);
  devTerminalCwdPersist = devTerminalCwdPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(DEV_TERMINAL_CWDS_FILE, devTerminalCwdLine(id, cwd)))
    .catch((e) => console.error(`[dev-terminal-cwds] failed to persist: ${messageOf(e)}`));
}

// One agent's session -> conversation log. codex and antigravity both mint their own id and both
// only learn it after the spawn, so each keeps this map on disk: one that dies with the process
// leaves the conversation there with nothing pointing at it. Separate files, one shape.
function conversationLog(fileName: string, label: string) {
  const conversations = new Map<string, AgentConversation>();
  const file = path.join(MULMOTERMINAL_HOME, fileName);
  // Sessions this process has already recorded. Hydration reads the file as it was BEFORE our
  // append could reach it, so without this a session spawned during startup is overwritten by an
  // older line — and the cwd it answers with would be the directory that session used to run in.
  const writtenIds = new Set<string>();

  const hydrated: Promise<void> = (async () => {
    try {
      // Streamed rather than read whole: one line per spawn, and nothing prunes it.
      await forEachJsonlRecord(file, (parsed) => {
        const record = agentConversationRecord(parsed, isValidSessionId);
        if (record) hydrateAgentConversationInto(conversations, writtenIds, record);
      });
    } catch {
      // absent on first run / unreadable => nothing to resume, which is today's behaviour anyway
    }
  })();

  let persist: Promise<void> = Promise.resolve();

  // Re-read the file, folding in lines appended SINCE the last read. ~/.mulmoterminal is shared by
  // every MulmoTerminal process on the machine, and a hydration done once at boot never sees a
  // session another process started later — its tmux session is visible to an occupancy check, but
  // nothing here ties the key to a directory, so the check reads the worktree as free (#1534
  // review). Whole-file rather than offset-tracked: the logs are a few KB and append-only, and
  // `hydrateAgentConversationInto` already makes a replay idempotent (newest line wins, own writes
  // protected by `writtenIds`).
  async function refresh(): Promise<void> {
    await hydrated;
    try {
      await forEachJsonlRecord(file, (parsed) => {
        const record = agentConversationRecord(parsed, isValidSessionId);
        if (record) hydrateAgentConversationInto(conversations, writtenIds, record);
      });
    } catch {
      // absent / unreadable => nothing new to fold in
    }
  }

  function remember(sessionId: string, conversationId: string, cwd: string): void {
    if (!isValidSessionId(sessionId) || !isValidSessionId(conversationId) || !cwd) return;
    const known = conversations.get(sessionId);
    if (known?.conversationId === conversationId && known.cwd === cwd) return; // already the answer; appending would only grow the log
    // Carried over rather than re-stamped: a session relaunched somewhere else appends a second
    // line, and taking the clock there would make `startedAt` mean "last written", which is not
    // what a reader sorting by it would get. The first line for a session is written at its spawn.
    const record: AgentConversation = { sessionId, conversationId, cwd, startedAt: known?.startedAt ?? Date.now() };
    writtenIds.add(sessionId);
    applyAgentConversation(conversations, record);
    persist = persist
      .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
      .then(() => fs.appendFile(file, agentConversationLine(record)))
      .catch((e) => console.error(`[${label}] failed to persist: ${messageOf(e)}`));
  }

  return { conversations, hydrated, remember, refresh };
}

// Seed a claimed set with every conversation the log already maps, once it is read. The claims are
// otherwise in-memory only, so a restart forgot them — and muse's spawn watcher, whose `before`
// snapshot can come back EMPTY from a busy sqlite, could then attribute a conversation that has
// belonged to another session since before this process started (#1533). A conversation a log
// already names is never the one a fresh spawn just minted, so claiming it costs nothing.
function seedClaimsFromLog(log: { conversations: ReadonlyMap<string, AgentConversation>; hydrated: Promise<void> }, claimed: Set<string>): void {
  void log.hydrated.then(() => {
    for (const record of log.conversations.values()) claimed.add(record.conversationId);
  });
}

// Which muse session each mulmo session runs, so a cold reconnect can resume it with
// `muse resume <id>`.
const museLog = conversationLog("muse-sessions.jsonl", "muse-sessions");
export const museConversations: ReadonlyMap<string, AgentConversation> = museLog.conversations;
export const museConversationsHydrated = museLog.hydrated;
export const rememberMuseSession = museLog.remember;
export const claimedMuseSessions = new Set<string>();
seedClaimsFromLog(museLog, claimedMuseSessions);

// Which agy conversation each antigravity session runs, so a cold reconnect can resume it with
// `agy --conversation <id>`.
const antigravityLog = conversationLog("antigravity-conversations.jsonl", "antigravity-conversations");
export const antigravityConversations: ReadonlyMap<string, AgentConversation> = antigravityLog.conversations;
export const antigravityConversationsHydrated = antigravityLog.hydrated;
/** Map a session to the agy conversation it is running, and persist it. */
export const rememberAntigravityConversation = antigravityLog.remember;
seedClaimsFromLog(antigravityLog, claimedAntigravityConversations);

// The same, for codex: which rollout each codex session runs, so a cold reconnect can resume it
// with `codex resume <id>`.
const codexLog = conversationLog("codex-rollouts.jsonl", "codex-rollouts");
export const codexRollouts: ReadonlyMap<string, AgentConversation> = codexLog.conversations;
export const codexRolloutsHydrated = codexLog.hydrated;
/** Map a session to the codex rollout it is running, and persist it. */
export const rememberCodexRollout = codexLog.remember;

/** Fold in conversation-log lines appended by ANOTHER MulmoTerminal process since our last read —
 *  what an occupancy check calls before matching tmux survivors against the maps, so a session a
 *  second process started is not read as "no record ties this key to a directory". */
export const refreshAgentConversations = async (): Promise<void> => {
  await Promise.all([museLog.refresh(), antigravityLog.refresh(), codexLog.refresh()]);
};

// The custom-agent mapping's own log (#1414). Same shape as the memos below and kept for the same
// reason: it must survive reap and a restart, because the transcript it describes does.
const CUSTOM_AGENT_SESSIONS_FILE = path.join(MULMOTERMINAL_HOME, "custom-agent-sessions.jsonl");

// Ids this process has already written. Hydration reads the file as it was BEFORE our append could
// reach it, so without this a session spawned during startup is overwritten by an older line — and
// a cell that just moved to another agent would resume on the previous one.
const customAgentWrittenIds = new Set<string>();

export const customAgentSessionsHydrated: Promise<void> = (async () => {
  try {
    await forEachJsonlRecord(CUSTOM_AGENT_SESSIONS_FILE, (parsed) => {
      const record = customAgentSessionRecord(parsed, isValidSessionId, isCustomAgentId);
      if (record && !customAgentWrittenIds.has(record.sessionId)) applyCustomAgentSession(customAgentSessions, record);
    });
  } catch {
    // absent on first run / unreadable => nothing remembered, and a resume falls back to plain claude
  }
})();

let customAgentPersist: Promise<void> = Promise.resolve();

/** Record that a session runs on a custom agent, and persist it. */
export function rememberCustomAgentSession(sessionId: string, agentId: string): void {
  if (!isValidSessionId(sessionId) || !isCustomAgentId(agentId)) return;
  customAgentWrittenIds.add(sessionId);
  if (customAgentSessions.get(sessionId) === agentId) return; // already the answer; appending would only grow the log
  applyCustomAgentSession(customAgentSessions, { sessionId, agentId });
  customAgentPersist = customAgentPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(CUSTOM_AGENT_SESSIONS_FILE, customAgentSessionLine({ sessionId, agentId })))
    .catch((e) => console.error(`[custom-agent-sessions] failed to persist: ${messageOf(e)}`));
}

// The one-line note the user wrote on a session (#1084). Their own words about what a cell is
// for, which is the one thing nothing else here knows: lastPrompt and aiTitle both describe what
// the agent said. Kept across reap and across a restart — a note the user typed is theirs, and
// resuming the session brings it back.
export const sessionMemos = new Map<string, string>();
const SESSION_MEMOS_FILE = path.join(MULMOTERMINAL_HOME, "session-memos.jsonl");

// Ids this process has already written. Hydration reads the file as it was BEFORE our append
// could reach it, so without this an edit made during startup is overwritten by the old value —
// and an ERASE has no map entry to notice, so the erased memo would come back from the dead.
const memoWrittenIds = new Set<string>();

export const sessionMemosHydrated: Promise<void> = (async () => {
  try {
    // Streamed rather than read whole: nothing caps this file, since it grows for as long as the
    // user keeps editing memos.
    await forEachJsonlRecord(SESSION_MEMOS_FILE, (parsed) => {
      const record = sessionMemoRecord(parsed, isValidSessionId);
      if (record && !memoWrittenIds.has(record.id)) applySessionMemo(sessionMemos, record);
    });
  } catch {
    // absent on first run / unreadable => no memos, which is how every session starts anyway
  }
})();

let memoPersist: Promise<void> = Promise.resolve();
const memoWrites = createMemoWriteGuard();

/**
 * Store a session's memo, or erase it when the text normalizes to empty. Resolves to what was
 * stored — the store's answer, not the request's — once the append is ON DISK.
 *
 * AWAITED, unlike the fire-and-forget appenders above, and the difference is what is being
 * written: a cwd or an id is derived state this server can work out again, while a memo is a
 * sentence the user typed and nothing can reconstruct. So a failed write REJECTS and puts the
 * previous value back, rather than logging and leaving a note on screen that is not saved
 * anywhere and vanishes at the next restart (CodeRabbit).
 */
export async function setSessionMemo(id: string, text: string): Promise<string> {
  const memo = normalizeMemo(text);
  if (!isValidSessionId(id)) return memo;
  const previous = sessionMemos.get(id);
  const ticket = memoWrites.begin(id);
  memoWrittenIds.add(id);
  applySessionMemo(sessionMemos, { id, text: memo });
  const append = memoPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(SESSION_MEMOS_FILE, sessionMemoLine(id, memo, Date.now())));
  // The CHAIN must survive this write failing — it is what serializes the appends, and a rejected
  // promise left in it would take down every memo written afterwards.
  memoPersist = append.catch(() => {});
  try {
    await append;
  } catch (e) {
    // Only while this is still the newest write for the id. Matching on the VALUE instead would
    // roll back over a later write that carried the same text and succeeded — leaving this process
    // serving the old note while the disk holds the new one (Codex).
    if (memoWrites.isLatest(id, ticket)) applySessionMemo(sessionMemos, { id, text: previous ?? "" });
    throw new Error(`failed to persist the memo: ${messageOf(e)}`, { cause: e });
  }
  return memo;
}

// Which GUI tool groups a session actually has. Learned from the group URLs it connects to
// (see session-tool-groups.ts) rather than configured here — a grid cell's GUI tools come
// from the user's own per-folder MCP config, which we do not read. Read it through
// sessionToolGroups() so callers can't mutate the stored set.
const toolGroupsBySession = new Map<string, Set<ToolGroup>>();
const SESSION_TOOL_GROUPS_FILE = path.join(MULMOTERMINAL_HOME, "session-tool-groups.json");

async function readPersistedToolGroups(): Promise<SessionToolGroup[]> {
  try {
    return parseSessionToolGroups(await fs.readFile(SESSION_TOOL_GROUPS_FILE, "utf8"), isValidSessionId);
  } catch {
    return [];
  }
}

// Ids a spawn has already superseded this process. Hydration reads the log as it was BEFORE
// that spawn's reset marker could be appended, so without this it would put the old groups
// back — the reset would win in the file and lose in memory.
const resetToolGroupSessions = new Set<string>();

export const sessionToolGroupsHydrated: Promise<void> = (async () => {
  for (const { sessionId, group } of await readPersistedToolGroups()) {
    if (resetToolGroupSessions.has(sessionId)) continue;
    addToolGroupInMemory(sessionId, group);
  }
})();

let toolGroupsPersist: Promise<void> = Promise.resolve();
function appendSessionToolGroup(sessionId: string, group: ToolGroup): void {
  toolGroupsPersist = toolGroupsPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(SESSION_TOOL_GROUPS_FILE, sessionToolGroupLine(sessionId, group)))
    .catch((e) => console.error(`[session-tool-groups] failed to persist: ${messageOf(e)}`));
}

function addToolGroupInMemory(sessionId: string, group: ToolGroup): boolean {
  const groups = toolGroupsBySession.get(sessionId) ?? new Set<ToolGroup>();
  if (groups.has(group)) return false;
  groups.add(group);
  toolGroupsBySession.set(sessionId, groups);
  return true;
}

// Note that a session reached us on a group's URL, then persist. A no-op once known, so the
// per-request MCP calls (one server is built per request) don't append on every tool call.
export function markSessionToolGroup(sessionId: string, group: ToolGroup): void {
  if (!SESSION_ID_RE.test(sessionId)) return;
  if (addToolGroupInMemory(sessionId, group)) appendSessionToolGroup(sessionId, group);
}

export function sessionToolGroups(sessionId: string): ToolGroup[] {
  return [...(toolGroupsBySession.get(sessionId) ?? [])];
}

/** Settles once every persist queued so far has hit the disk.
 *
 *  The appends above are deliberately fire-and-forget — a tool call must not wait on a log — but
 *  that leaves no way to know they are done, and each one begins with `mkdir(…, recursive)`. A
 *  caller that deletes the home directory before the queue drains has it RECREATED underneath it,
 *  which is how a spec pointing HOME at a temp directory left one behind on every single run
 *  (#1345). Awaiting this before cleaning up is what makes that deterministic. */
export const whenToolGroupsPersisted = (): Promise<void> => toolGroupsPersist;

// Forget what a session had, because it is being replaced. Called on every claude spawn for the
// id: the new process gets whatever the user's MCP config says NOW, so carrying the old answer
// forward would keep asserting a capability the user may have just switched off. The marker is
// appended rather than the file rewritten, for the same reason nothing else here is rewritten.
// UNCONDITIONAL, and that is the point. Skipping the marker when the in-memory set looks empty
// was wrong twice over on a resume at boot: hydration may not have run yet, so "empty" means
// "not read yet" rather than "nothing there" — and the marker is the only thing that survives to
// the NEXT restart, where a process-local memo would be gone and the log replayed from scratch.
// One line per claude spawn, in a file that already grows per learned group.
export function resetSessionToolGroups(sessionId: string): void {
  if (!SESSION_ID_RE.test(sessionId)) return;
  // Both flags set synchronously, before any await: a read landing between here and the append
  // must not see the replaced process's capabilities, and hydration must not restore them.
  resetToolGroupSessions.add(sessionId);
  toolGroupsBySession.set(sessionId, new Set());
  toolGroupsPersist = toolGroupsPersist
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(() => fs.appendFile(SESSION_TOOL_GROUPS_FILE, sessionToolGroupLine(sessionId, TOOL_GROUP_RESET)))
    .catch((e) => console.error(`[session-tool-groups] failed to persist reset: ${messageOf(e)}`));
}

// Restore the `working` + blocked/done (`waiting`) flags across a server restart (e.g. a
// --watch hot reload), so a live session doesn't reattach as idle. `waiting` matters because
// Claude won't re-fire Notification while already sitting at a prompt; `working` because a
// turn usually outlives the ~1s restart and its later Stop hook self-corrects a stale flag
// (the only stale case is a turn that finished DURING the restart window — corrected on the
// user's next turn). Read paths await hydration (see /api/activity, /api/session) so a
// reconnect re-fetch can't race it back to idle. Mirrors the dev-terminal-sessions pattern.
const ACTIVITY_STATE_FILE = path.join(MULMOTERMINAL_HOME, "activity-state.json");
export const activityStateHydrated: Promise<void> = (async () => {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(ACTIVITY_STATE_FILE, "utf8"));
    for (const { id, working, waiting, event } of parseActivityState(parsed, (x) => SESSION_ID_RE.test(x))) {
      // Don't clobber a live update that already landed while hydration was in flight.
      if (!activity.has(id)) activity.set(id, { working, waiting, event, at: Date.now() });
    }
  } catch {
    // no file yet / unreadable => nothing to restore
  }
})();

// The sessions THIS process drives (every id it has flagged working/waiting). The file is
// shared with any other server rooted at the same MULMOTERMINAL_HOME, and hydration pulls the
// other instance's ids into `activity` too — so a snapshot of the whole map is not this
// instance's to write back. Ownership is claimed on the flag, not derived from `ptys`, so a
// just-reaped session (pty already gone) is still recognised as ours and removed from the file.
const ownedActivityIds = new Set<string>();
export function claimActivityOwnership(id: string): void {
  ownedActivityIds.add(id);
}

async function readPersistedActivity(): Promise<Record<string, PersistedActivity>> {
  try {
    const parsed = parseActivityState(JSON.parse(await fs.readFile(ACTIVITY_STATE_FILE, "utf8")), (x) => SESSION_ID_RE.test(x));
    return Object.fromEntries(parsed.map(({ id, working, waiting, event }) => [id, { working, waiting, event }]));
  } catch {
    return {}; // no file yet / unreadable => nothing to preserve
  }
}

// Serialize writes into one chain (like appendDevTerminalSession). Read the current file and
// rewrite only the entries THIS instance owns, so a second instance's sessions are neither
// dropped nor revived. `isHidden` comes from the caller rather than closing over
// `hiddenSessions`: which sessions are hidden is the session layer's policy, and this module
// owns storage, not policy.
let activityPersist: Promise<void> = Promise.resolve();
export function persistActivityState(isHidden: (id: string) => boolean): void {
  activityPersist = activityPersist
    .then(() => activityStateHydrated)
    .then(() => fs.mkdir(MULMOTERMINAL_HOME, { recursive: true }))
    .then(async () => {
      const onDisk = await readPersistedActivity();
      const owned = buildActivitySnapshot(
        [...activity].filter(([id]) => ownedActivityIds.has(id)),
        isHidden,
      );
      const next = mergeOwnedActivity(onDisk, owned, (id) => ownedActivityIds.has(id));
      await fs.writeFile(ACTIVITY_STATE_FILE, JSON.stringify(next));
    })
    .catch((e) => console.error(`[activity-state] failed to persist: ${messageOf(e)}`));
}
