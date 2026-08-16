// The session routes: what the sidebar lists, what one session looks like, and the
// attention flags the grid polls. They come out of index.ts last of step 2 (#548) because
// they were the most entangled — every reader they call had to become a module first.
//
// `freshenRosterTitle` is the one thing still injected: re-titling a viewed session spawns
// a summarizer, which belongs to the title machinery index.ts still owns.
import type { Express, Request, Response } from "express";
import { promises as fs } from "node:fs";
import { SESSION_ID_RE } from "../config/env.js";
import { normalizeAgent, workspaceForRoute } from "./routeParams.js";
import { hasErrnoCode } from "../errors.js";
import { isProbeSessionId } from "../agents/probe-session.js";
import {
  activity,
  activityStateHydrated,
  aiTitles,
  antigravityConversations,
  codexRollouts,
  backgroundSessionsHydrated,
  failedWorkersHydrated,
  unplacedSessionsHydrated,
  placedSessionsHydrated,
  unplacedSessionRows,
  ptys,
  devTerminalSessions,
  devTerminalSessionsHydrated,
  isBackgroundSession,
  lastPrompts,
  lastResponses,
  sessionMemos,
  sessionMemosHydrated,
  setSessionMemo,
  translationWorkerIds,
} from "../session/registry.js";
import {
  collectOnDiskSessionStats,
  collectPendingSessions,
  readSessionMeta,
  readSessionSummary,
  sessionLastTurn,
  sessionPrompts,
  sessionTimeline,
} from "../session/session-reads.js";
import { formatHandoff, type HandoffShape } from "../session/handoff-text.js";
import { projectSessionsDir } from "../session/project-dir.js";
import { runningKeyOf, runningSessionKeys, sessionAttached, survivorSnapshot } from "../session/dir-session.js";
import type { SessionOccupancy } from "../../common/sessionOccupancy.js";
import type { SessionRunning } from "../../common/sessionRunning.js";
import { tmuxAttachedCounts } from "../infra/tmux.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { listCodexSessions } from "../agents/codex-sessions.js";
import { antigravityBrainRoot } from "../agents/antigravity-session.js";
import { listAntigravitySessions } from "../agents/antigravity-sessions.js";
import { grokSessionsRoot } from "../agents/grok-session.js";
import { listGrokSessions } from "../agents/grok-sessions.js";
import { listMuseSessionsForCwd, museSessionLogPath } from "../agents/muse-session.js";
import { museConversations, museConversationsHydrated } from "../session/registry.js";
import { conversationSessionKeys, type AgentConversation } from "../session/agent-conversations.js";
import { AGENT_SESSION_LIST_PATHS } from "../../common/agentSessionList.js";
import { TERMINAL_AGENTS, type TerminalAgent } from "../../common/sessionAgent.js";
import type { SessionMeta } from "../session/types.js";
import { parseActivityIds, selectSessionRows } from "../session/session-list.js";
import { agentBadges } from "../session/agent-badges.js";
import { sessionDetailView } from "../session/session-detail-view.js";
import { clearedTranscripts } from "../session/cleared-transcripts.js";
import { requestBody } from "./requestBody.js";

// Only the most-recent N sessions are listed in the sidebar; older ones aren't
// read or parsed, keeping /api/sessions cheap for projects with many sessions.
const SESSION_LIST_LIMIT = 50;
// Background workers are capped separately (see selectSessionRows) and are behind a filter
// the user has to press, so only the recent handful is worth listing at all.
const BACKGROUND_SESSION_LIST_LIMIT = 10;
// Cap on ids per /api/activity request — a grid can't show more cells than this, and
// it bounds the query string a client can make us parse.
const ACTIVITY_IDS_LIMIT = 200;

export interface SessionRouteDeps {
  /** Kick off a re-title for a session the roster just showed, when it has moved on enough. */
  freshenRosterTitle: (sessionId: string, cwd: string, currentUserTurns: number) => void;
  /** Fan a session's row out on the "sessions" channel, so every OTHER open cell, tab and
   *  phone sees an edited memo without asking. */
  publishActivity: (sessionId: string) => void;
}

// GRID-ONLY (dev_tool): initial per-session status + last prompt, so a grid cell
// can render its header immediately (live updates then arrive via the "sessions"
// pub/sub channel). The single view reads activity straight from that channel.
// ?cwd= locates the transcript so a freshly-resumed session shows its most recent
// prompt; the live in-memory prompt (this process run) takes precedence.
async function sessionDetail(req: Request<{ id: string }>, res: Response, freshenRosterTitle: SessionRouteDeps["freshenRosterTitle"]) {
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  await activityStateHydrated; // a reconnect re-fetch must see the restored working/waiting, not idle
  // `?agent=` decides where the two header badges are read from — nothing else on this route. It
  // defaults to Claude, so a client that does not send it (an older build, the single view) gets
  // exactly what it got before.
  const agent = normalizeAgent(req.query.agent);
  const { lastPrompt: transcriptPrompt, lastResponse: transcriptResponse, userTurns, usage, context, workPhase } = await readSessionSummary(cwd, id);
  let badges = agent === "claude" ? { usage, context } : await agentBadges(cwd, id, agent);
  // A cell that is actually running Muse but whose persisted `agent` is still "claude" (created
  // before the Muse feature, or reconnecting from an older client) would otherwise show no badge:
  // the Claude transcript has no file for this id, so the read above is empty. Muse's own log
  // answers it, and the header self-heals.
  //
  // Gated rather than run on the empty read alone: empty is also the normal state of every claude
  // cell before its first turn, and the unguarded version folded a session log on each of those
  // polls to answer for a session muse has never heard of.
  //
  // Two gates, cheapest first, because the map alone is not the whole answer (Codex on #1513). The
  // in-memory map knows every session THIS SERVER started as muse, across a restart too — but a
  // history row opened before its spawn recorded the mapping, and a session started from a plain
  // terminal, are muse's own ids and appear in no map of ours. One indexed lookup covers those.
  if (agent === "claude" && badges.context.model === null && badges.usage.inputTokens === 0) {
    await museConversationsHydrated;
    if (museConversations.has(id) || (await museSessionLogPath(id).catch(() => null))) {
      const museFallback = await agentBadges(cwd, id, "muse").catch(() => null);
      if (museFallback && museFallback.context.model !== null) badges = museFallback;
    }
  }
  // If we haven't titled it yet, kick off a summary; sessionDetailView falls back meanwhile.
  freshenRosterTitle(id, cwd, userTurns);
  await sessionMemosHydrated; // a cell seeding on boot must not be told its memo is gone
  const view = sessionDetailView(
    { lastPrompt: lastPrompts.get(id), lastResponse: lastResponses.get(id), aiTitle: aiTitles.get(id), memo: sessionMemos.get(id) },
    { lastPrompt: transcriptPrompt, lastResponse: transcriptResponse },
    activity.get(id) ?? {},
    clearedTranscripts.has(id),
  );
  res.json({ id, cwd, ...view, usage: badges.usage, context: badges.context, workPhase });
}

// The user's one-line note on a session (#1084). An empty text ERASES it — the same route, so a
// cleared input box needs no second endpoint and cannot be half-applied.
async function setMemo(req: Request<{ id: string }>, res: Response, publishActivity: SessionRouteDeps["publishActivity"]) {
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
  const { text } = requestBody(req.body);
  if (typeof text !== "string") return res.status(400).json({ error: "text must be a string" });
  await sessionMemosHydrated; // or a write during startup is undone by the file it raced
  try {
    // Awaited: acknowledging before the append lands would show the user a note that is not saved
    // anywhere, and it would then disappear at the next restart with nothing having reported an
    // error. The store rolls its own in-memory value back on failure, so a 500 leaves both sides
    // agreeing that the memo was not written.
    const memo = await setSessionMemo(id, text);
    publishActivity(id);
    // The STORED memo, not the request's: normalization collapses and caps what was typed, and a
    // client that echoed its own text would show something the next reload disagrees with.
    res.json({ id, memo });
  } catch (err) {
    console.error("[api] /api/session/:id/memo failed:", err);
    res.status(500).json({ error: "failed to save the memo" });
  }
}

// Attention state (working / waiting / event) for an explicit set of session ids.
// The grid uses this to seed the status of its OFF-PAGE cells, which /api/sessions
// can't serve: it hides dev-terminal sessions and is capped by the list limit. Reads
// only the in-memory activity map (no disk), so it's cheap to call per grid render.
async function activitySnapshot(req: Request, res: Response) {
  await activityStateHydrated; // the grid re-seeds this on reconnect — must not race hydration back to idle
  const ids = parseActivityIds(req.query.ids, (id) => SESSION_ID_RE.test(id), ACTIVITY_IDS_LIMIT);
  const out: Record<string, { working: boolean; waiting: boolean; event: string | null }> = {};
  for (const id of ids) {
    const a = activity.get(id) || {};
    out[id] = { working: a.working ?? false, waiting: a.waiting ?? false, event: a.event ?? null };
  }
  res.json(out);
}

// The tool-activity timeline for a session (what the agent ran, newest last), so a
// cell can show "what did it do?" without scrolling the raw transcript.
async function toolTimeline(req: Request, res: Response) {
  const { session } = req.query;
  if (typeof session !== "string" || !SESSION_ID_RE.test(session)) return res.status(400).json({ error: "invalid session id" });
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  res.json(await sessionTimeline(cwd, session));
}

// What the USER asked this session for, newest last (#1748) — the mirror of the timeline above,
// which answers what the agent then did. Under /api/transcript for the same reason last-turn is:
// /api/session/:id would read "prompts" as a session id.
async function userPrompts(req: Request, res: Response) {
  const { session } = req.query;
  if (typeof session !== "string" || !SESSION_ID_RE.test(session)) return res.status(400).json({ error: "invalid session id" });
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  res.json(await sessionPrompts(cwd, session, normalizeAgent(req.query.agent)));
}

// A session's last completed exchange, already rendered as the text to paste into ANOTHER
// session's input box (#550). Reading the agent's own log instead of the terminal's screen
// buffer is the whole point: no ANSI frames, no spinner debris, no lines lost to scrollback,
// and a turn boundary that is recorded rather than guessed. The origin line is composed from
// what the server knows, so nothing the client sends ends up inside the text another agent
// will read. Sits under /api/transcript because /api/session/:id would match "last-turn"
// first and read it as a session id.
async function lastTurn(req: Request, res: Response) {
  const { session } = req.query;
  if (typeof session !== "string" || !SESSION_ID_RE.test(session)) return res.status(400).json({ error: "invalid session id" });
  const agent = normalizeAgent(req.query.agent);
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  const turn = await sessionLastTurn(cwd, session, agent);
  // ?as=reply drops the prompt block: the caller is relaying an ANSWER back to whoever
  // asked, and that prompt is the asker's own text coming home.
  const shape: HandoffShape = req.query.as === "reply" ? "reply" : "exchange";
  res.json({ ...turn, text: formatHandoff({ label: agent, cwd }, turn, undefined, shape) });
}

// List the chat sessions for the current project (CLAUDE_CWD), including
// newly-created sessions that aren't persisted to disk yet.
async function sessionList(req: Request, res: Response) {
  try {
    await activityStateHydrated; // list working/waiting from the restored state, not a racing idle
    // Optional ?cwd= scopes the list to that project's on-disk sessions (the grid
    // cell's resume picker). Without it, the classic single view's behavior is
    // unchanged: CLAUDE_CWD + in-memory pending sessions.
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const includePending = !req.query.cwd;
    // Wait for the persisted grid-session set before filtering (below), so a chat
    // request racing server boot can't leak previously-hidden grid transcripts. The
    // background and failed sets are awaited for BOTH queries — they decide a flag on the row
    // rather than whether the row is listed, and those flags are answered either way.
    //
    // `failed` especially: the whole value of persisting it is finding out LATER, and the most
    // likely "later" is the first list after a restart. Serving it as false while its log is
    // still being read would lose exactly the case the record exists for (Codex, PR #1188).
    if (includePending) await devTerminalSessionsHydrated;
    await backgroundSessionsHydrated;
    await failedWorkersHydrated;
    await sessionMemosHydrated; // the memo is the row's TITLE when there is one — a race shows the agent's words instead
    const dir = projectSessionsDir(cwd);
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch (err) {
      if (!hasErrnoCode(err) || err.code !== "ENOENT") throw err;
    }

    const onDiskStats = await collectOnDiskSessionStats(dir, files);
    const onDisk = new Set(onDiskStats.map((s) => s.id));
    // Pending is skipped for a cwd-scoped query (pending sessions aren't tracked per dir).
    const pending = collectPendingSessions(onDisk, includePending);

    // Keep only the most-recent N, then read & parse contents for just those
    // on-disk files (a deleted/corrupt file is dropped, not fatal). Hidden translation
    // workers are dropped first — they're transient internal helpers, not user chats.
    const top = selectSessionRows([...onDiskStats, ...pending], {
      isInternalHelper: (id) => translationWorkerIds.has(id) || isProbeSessionId(id),
      isDevTerminal: (id) => devTerminalSessions.has(id),
      isBackground: (id) => isBackgroundSession(id),
      includePending,
      limit: SESSION_LIST_LIMIT,
      backgroundLimit: BACKGROUND_SESSION_LIST_LIMIT,
    });
    const sessions = (
      await Promise.all(
        top.map((s) =>
          s.kind === "pending"
            ? // Wrapped rather than handed to Promise.all bare: a pending row is already the whole
              // answer, and spelling it as a promise says the two branches meet at the same type.
              Promise.resolve({
                id: s.id,
                title: s.title,
                mtime: s.mtime,
                working: s.working,
                waiting: s.waiting,
                event: s.event,
                hidden: s.hidden,
                failed: s.failed,
              })
            : readSessionMeta(dir, s.file).catch(() => null),
        ),
      )
    )
      .filter((s): s is SessionMeta => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    // Who is HOLDING each row, from one `list-clients` call for the whole list (#1207). The
    // picker used to answer this from the current page's own grid, which is blind to a second
    // browser tab and to a second mulmoterminal process — the two ways a running session got
    // taken over without anything warning first.
    const tmuxCounts = tmuxAttachedCounts();
    // What is still RUNNING for each row, which `list-clients` above cannot say — it reports only
    // sessions that have a client, and the ones that accumulate have none (#1467). Claude's key is
    // its conversation id (we pass it as `--session-id`), so unlike the other three agents there is
    // no log to consult: the row's own id is the key.
    const running = runningSessionKeys();
    res.json({
      cwd,
      sessions: sessions.map((s) => ({ ...s, attached: sessionAttached(s.id, tmuxCounts), runningKey: runningKeyOf([s.id], running) })),
    });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

/**
 * Who is HOLDING each row of an agent's own conversation list, so the launcher can refuse one that
 * is open somewhere else — the same field `/api/sessions` puts on a Claude row, answered from one
 * `list-clients` call for the whole list.
 *
 * Two ways a conversation can be held, and the second is why this takes the log:
 *
 * 1. Resumed FROM this list, the session key IS the conversation id (ws-routes hands the id
 *    straight to the spawner), so the id can be asked about directly.
 * 2. Started from a grid cell, the key is one MulmoTerminal minted and only the conversation log
 *    connects the two. Ask about the id alone and a conversation live in another cell reads as
 *    free — and resuming it starts a SECOND agent process on it.
 *
 * grok needs no log for this: we mint its session id, so key and conversation id are the same
 * string and case 1 covers it. It still passes an empty iterable rather than skipping the call, so
 * all three lists answer the question the same way.
 */
function withAttached<T extends { id: string }>(
  sessions: T[],
  records: Iterable<AgentConversation>,
  running: ReadonlySet<string>,
): (T & SessionOccupancy & SessionRunning)[] {
  // `running` comes from the caller's `survivorSnapshot()`, taken BEFORE the caller built its
  // list: the snapshot refreshes the shared conversation logs first and reads the running keys
  // after, so a session another MulmoTerminal process started is in the list, in the holders map
  // and in `running` alike. Taking it here — after the list was built — left the agy list, whose
  // ROWS are drawn from the conversation map, missing such a session entirely (#1534 review).
  const holders = conversationSessionKeys(records);
  const tmuxCounts = tmuxAttachedCounts();
  return sessions.map((s) => {
    const keys = [s.id, ...(holders.get(s.id) ?? [])];
    return {
      ...s,
      attached: keys.some((key) => sessionAttached(key, tmuxCounts)),
      runningKey: runningKeyOf(keys, running),
    };
  });
}

// codex's own sessions for a workspace (?cwd=, default CLAUDE_CWD), read from ~/.codex rollouts.
//
// This and the two below are what the launcher's "or resume here" list reads when the Agent Picker
// is on something other than Claude (#1417): one list per agent rather than one merged list, so a
// row is always resumed by the agent that wrote it. Claude's own rows come from /api/sessions
// above, which reads ~/.claude/projects and nothing else.
async function codexSessionList(req: Request, res: Response) {
  try {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const running = await survivorSnapshot();
    const sessions = await listCodexSessions(codexSessionsRoot(), cwd, SESSION_LIST_LIMIT);
    res.json({ cwd, sessions: withAttached(sessions, codexRollouts.values(), running) });
  } catch (err) {
    console.error("[api] /api/codex/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

// agy's own conversations for a workspace (?cwd=, default CLAUDE_CWD). Mirrors the codex route
// above, with one difference that is not cosmetic: the cwd comes from OUR log rather than from
// agy, so the answer is empty until that log has been read off disk. codex needs no such wait —
// it re-reads its rollouts on every request.
async function antigravitySessionList(req: Request, res: Response) {
  try {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    // BEFORE the list is built, not only before occupancy: the agy rows themselves are drawn from
    // the conversation map (the cwd comes from OUR log), so a mapping another process appended has
    // to be folded in first or the row is missing from this response entirely (#1534 review).
    const running = await survivorSnapshot();
    const sessions = await listAntigravitySessions(antigravityBrainRoot(), antigravityConversations.values(), cwd, SESSION_LIST_LIMIT);
    res.json({ cwd, sessions: withAttached(sessions, antigravityConversations.values(), running) });
  } catch (err) {
    console.error("[api] /api/antigravity/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

// grok's own conversations for a workspace (?cwd=, default CLAUDE_CWD). The cheapest of the three:
// ~/.grok/sessions is partitioned by working directory, so there is no date tree to scan and no
// log to consult — the cwd IS the directory name (server/agents/grok-sessions.ts).
async function grokSessionList(req: Request, res: Response) {
  try {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const sessions = await listGrokSessions(grokSessionsRoot(), cwd, SESSION_LIST_LIMIT);
    // No conversation log: grok's session key is the id we minted, which is also the directory
    // name — so `withAttached` finds a holder by the row's own id (see its header).
    res.json({ cwd, sessions: withAttached(sessions, [], await survivorSnapshot()) });
  } catch (err) {
    console.error("[api] /api/grok/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

async function museSessionList(req: Request, res: Response) {
  try {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const running = await survivorSnapshot();
    const metas = await listMuseSessionsForCwd(cwd);
    const sorted = [...metas].sort((a, b) => (b.updatedAtUs ?? 0) - (a.updatedAtUs ?? 0));
    const sessions = sorted.slice(0, SESSION_LIST_LIMIT).map((m) => ({
      id: m.id,
      title: m.title || m.id,
      mtime: m.updatedAtUs ? m.updatedAtUs / 1000 : 0,
      model: m.modelId ?? undefined,
    }));
    res.json({ cwd, sessions: withAttached(sessions, museConversations.values(), running) });
  } catch (err) {
    console.error("[api] /api/muse/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

// Which handler answers each agent's listing. Keyed by the same type as the paths, so the two are
// added together or not at all.
const AGENT_SESSION_LISTS: Record<TerminalAgent, (req: Request, res: Response) => Promise<void>> = {
  claude: sessionList,
  codex: codexSessionList,
  antigravity: antigravitySessionList,
  grok: grokSessionList,
  muse: museSessionList,
};

export function mountSessionRoutes(app: Express, deps: SessionRouteDeps): void {
  app.get("/api/session/:id", (req, res) => sessionDetail(req, res, deps.freshenRosterTitle));
  app.post("/api/session/:id/memo", (req, res) => setMemo(req, res, deps.publishActivity));
  app.get("/api/activity", activitySnapshot);
  app.get("/api/transcript/timeline", toolTimeline);
  app.get("/api/transcript/prompts", userPrompts);
  app.get("/api/transcript/last-turn", lastTurn);
  // The sessions a loading grid should adopt: spawned VISIBLE by the server and never taken by a
  // cell (a scheduled task's chat, one the phone started, one an agent started from another
  // session). Deliberately its own endpoint answering a server-side marker, rather than the grid
  // diffing "all sessions" against its own state: a diff would sweep up ordinary sessions and
  // change what a reload does to a normal cell, which is the one thing this whole line of work
  // must not do.
  //
  // Hidden workers are absent by construction — the mark is only ever set for a visible spawn —
  // and a spec pins that, since "it happens not to be marked" and "it cannot be marked" read the
  // same until someone adds a caller.
  app.get("/api/sessions/unplaced", async (_req, res) => {
    await Promise.all([unplacedSessionsHydrated, placedSessionsHydrated]);
    const sessions = unplacedSessionRows().map(({ id, agent }) => {
      const entry = ptys.get(id);
      // A session whose PTY is gone (the server restarted, tmux ended) is still worth adopting —
      // the cell resumes it from disk. The AGENT comes from the mark rather than the entry for
      // exactly that case: a codex session adopted as claude reconnects on the wrong endpoint, and
      // the entry that would have said so is what is missing (Codex, PR #1189). The live entry
      // still wins when there is one — it is the process actually running.
      return { id, agent: entry?.agent ?? agent, cwd: entry?.cwd ?? null };
    });
    res.json({ sessions });
  });
  // The four conversation listings are mounted FROM the shared map rather than from literals
  // beside it (CodeRabbit on #1449). The map is what the launcher builds its URL from, so a fifth
  // agent that adds an entry there and no route here would 404 for that agent alone — and the
  // `Record<TerminalAgent, …>` on both sides means neither half can be forgotten.
  for (const agent of TERMINAL_AGENTS) {
    app.get(AGENT_SESSION_LIST_PATHS[agent], AGENT_SESSION_LISTS[agent]);
  }
}
