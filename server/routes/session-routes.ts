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
  backgroundSessionsHydrated,
  failedWorkersHydrated,
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
  sessionTimeline,
} from "../session/session-reads.js";
import { formatHandoff, type HandoffShape } from "../session/handoff-text.js";
import { projectSessionsDir } from "../session/project-dir.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { listCodexSessions } from "../agents/codex-sessions.js";
import type { SessionMeta } from "../session/types.js";
import { parseActivityIds, selectSessionRows } from "../session/session-list.js";
import { sessionDetailView } from "../session/session-detail-view.js";
import { clearedTranscripts } from "../session/cleared-transcripts.js";

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
  const { lastPrompt: transcriptPrompt, lastResponse: transcriptResponse, userTurns, usage, context, workPhase } = await readSessionSummary(cwd, id);
  // If we haven't titled it yet, kick off a summary; sessionDetailView falls back meanwhile.
  freshenRosterTitle(id, cwd, userTurns);
  await sessionMemosHydrated; // a cell seeding on boot must not be told its memo is gone
  const view = sessionDetailView(
    { lastPrompt: lastPrompts.get(id), lastResponse: lastResponses.get(id), aiTitle: aiTitles.get(id), memo: sessionMemos.get(id) },
    { lastPrompt: transcriptPrompt, lastResponse: transcriptResponse },
    activity.get(id) ?? {},
    clearedTranscripts.has(id),
  );
  res.json({ id, cwd, ...view, usage, context, workPhase });
}

// The user's one-line note on a session (#1084). An empty text ERASES it — the same route, so a
// cleared input box needs no second endpoint and cannot be half-applied.
async function setMemo(req: Request<{ id: string }>, res: Response, publishActivity: SessionRouteDeps["publishActivity"]) {
  const { id } = req.params;
  if (!SESSION_ID_RE.test(id)) return res.status(400).json({ error: "invalid session id" });
  const { text } = req.body ?? {};
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
            ? { id: s.id, title: s.title, mtime: s.mtime, working: s.working, waiting: s.waiting, event: s.event, hidden: s.hidden, failed: s.failed }
            : readSessionMeta(dir, s.file).catch(() => null),
        ),
      )
    )
      .filter((s): s is SessionMeta => s !== null)
      .sort((a, b) => b.mtime - a.mtime);

    res.json({ cwd, sessions });
  } catch (err) {
    console.error("[api] /api/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

// codex's own sessions for a workspace (?cwd=, default CLAUDE_CWD), read from ~/.codex rollouts —
// the single view's sidebar lists these so past codex conversations are switchable + resumable.
async function codexSessionList(req: Request, res: Response) {
  try {
    const cwd = workspaceForRoute(req.query.cwd, res);
    if (cwd === null) return;
    const sessions = await listCodexSessions(codexSessionsRoot(), cwd, SESSION_LIST_LIMIT);
    res.json({ cwd, sessions });
  } catch (err) {
    console.error("[api] /api/codex/sessions failed:", err);
    res.status(500).json({ error: String(err) });
  }
}

export function mountSessionRoutes(app: Express, deps: SessionRouteDeps): void {
  app.get("/api/session/:id", (req, res) => sessionDetail(req, res, deps.freshenRosterTitle));
  app.post("/api/session/:id/memo", (req, res) => setMemo(req, res, deps.publishActivity));
  app.get("/api/activity", activitySnapshot);
  app.get("/api/transcript/timeline", toolTimeline);
  app.get("/api/transcript/last-turn", lastTurn);
  app.get("/api/sessions", sessionList);
  app.get("/api/codex/sessions", codexSessionList);
}
