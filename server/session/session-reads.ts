// Reading sessions off disk: where Claude keeps a transcript, what one says, and the
// sidebar rows that fall out of it. Extracted from index.ts (#548) because the routes
// that serve this data cannot move until the readers do — every one of them would
// otherwise need the whole set injected.
//
// The readers touch the registry (a live in-memory title beats the on-disk one, and a
// row carries its session's activity flags), which is fine now that the registry is its
// own module: the dependency runs one way. One of them also WRITES — collectPendingSessions
// drops a session from knownSessions once disk has it — so "reads" describes the direction
// of the data, not a guarantee of purity.
import fsSync, { existsSync, readdirSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import {
  userPromptText,
  latestMeaningfulUserPromptFromParsed,
  latestAssistantTextFromParsed,
  timelineEventsIn,
  type SessionUsage,
  type LatestTurnContext,
  type PromptTrail,
  type TimelineEvent,
} from "./transcript.js";
import { createTranscriptFold, type FoldedAt } from "./transcript-fold.js";
import { classifyWorkPhase, type WorkPhase } from "./workPhase.js";
import { sessionListTitle } from "./sessionListTitle.js";
import {
  activity,
  aiTitles,
  claudeSessionIds,
  codexRollouts,
  codexRolloutsHydrated,
  isBackgroundSession,
  isFailedWorker,
  knownSessions,
  sessionMemos,
} from "./registry.js";
import { claudeHistoryFile, projectSessionsDir } from "./project-dir.js";
import {
  claudePromptScan,
  codexPromptScan,
  copyClaudePromptScan,
  foldClaudePrompt,
  foldCodexPrompt,
  historyIdsFor,
  promptWindow,
  transcriptPrompts,
  PROMPT_SCAN_LIMIT,
} from "./prompt-history.js";
import type { PromptWindow } from "../../common/promptHistory.js";
import { anchorOf, memoKeyFor, resumePlan, ANCHOR_BYTES, EMPTY_ANCHOR, type HistoryMemo } from "./prompt-history-memo.js";
import { clearedAtOf, clearedClaudeIdOf, clearedTranscripts } from "./cleared-transcripts.js";
import { currentTurnReplyFromClaudeParsed, lastTurnFromClaudeParsed, lastTurnFromCodexRolloutDocs, EMPTY_TURN, type LastTurn } from "./last-turn.js";
import { forEachJsonlRecord, forEachJsonlRecordIn, readTailRecords } from "../infra/jsonl-file.js";
import { copySummaryState, emptySummaryState, foldSummary, summaryPartsOf, type SummaryState } from "./summary-scan.js";
import { partitionPending } from "./partitionPending.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutPath } from "../agents/codex-sessions.js";
import { cursorTranscriptPath } from "../agents/cursor-sessions.js";
import { cursorLastTurnFromRecords } from "../agents/cursor-last-turn.js";
import type { DiskStat, PendingSession, SessionMeta } from "./types.js";
import { readString } from "../../common/readString.js";
import type { TerminalAgent } from "../../common/sessionAgent.js";

// Bytes of an assistant reply kept for the roster; the same cap the push body uses.
export const LAST_RESPONSE_MAX = 400;

// The reply as it is on disk RIGHT NOW, or null when there is none to read. Separate from
// the cache below because the two want opposite things on failure: the roster would rather
// keep showing the last reply it had, while a push must never describe a finished turn with
// the PREVIOUS turn's text — for that caller, null has to stay null.
export function readLatestResponse(id: string, cwd: string): string | null {
  try {
    // The tail, not the file: a transcript reaches 585 MB, which readFile cannot hold at all —
    // and the newest reply is in the last few lines either way (#998).
    const text = latestAssistantTextFromParsed(readTailRecords(path.join(projectSessionsDir(cwd), `${id}.jsonl`)));
    return text ? text.slice(0, LAST_RESPONSE_MAX) : null;
  } catch {
    return null; // no transcript yet / unreadable
  }
}

// Whether a session has an on-disk transcript (claude only writes it after the
// first prompt) in the given workspace. Determines whether `--resume` will work.
export function sessionExistsOnDisk(id: string, cwd: string): boolean {
  return existsSync(path.join(projectSessionsDir(cwd), `${id}.jsonl`));
}

// readdirSync that yields [] instead of throwing on a missing / unreadable dir.
export function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// Every session id with a Claude transcript on disk, across ALL project dirs — so the
// orphan-tmux cleanup can tell a resumable session from a pure orphan (per-cwd
// sessionExistsOnDisk can't, since a tmux orphan carries no cwd). A non-dir entry under
// the projects root reads as empty, so it's harmlessly skipped.
export function claudeOnDiskSessionIds(): Set<string> {
  const ids = new Set<string>();
  const root = path.join(os.homedir(), ".claude", "projects");
  for (const project of safeReaddir(root)) {
    for (const f of safeReaddir(path.join(root, project))) {
      if (f.endsWith(".jsonl")) ids.add(f.slice(0, -".jsonl".length));
    }
  }
  return ids;
}

// The most recent user prompt from a resumed session's on-disk transcript, so a
// freshly-resumed cell can show its last prompt instead of just the id. null if
// there's no transcript yet (a never-prompted session) or it can't be read.
export async function latestUserPrompt(cwd: string, id: string): Promise<string | null> {
  try {
    return latestMeaningfulUserPromptFromParsed(readTailRecords(path.join(projectSessionsDir(cwd), `${id}.jsonl`)));
  } catch {
    return null;
  }
}

export const EMPTY_USAGE: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
export const EMPTY_CONTEXT: LatestTurnContext = { model: null, contextTokens: 0 };
export interface SessionSummary {
  lastPrompt: string | null;
  aiTitle: string | null;
  lastResponse: string | null;
  userTurns: number;
  usage: SessionUsage;
  context: LatestTurnContext;
  workPhase: WorkPhase | null;
}
export const EMPTY_SUMMARY: SessionSummary = {
  lastPrompt: null,
  aiTitle: null,
  lastResponse: null,
  userTurns: 0,
  usage: EMPTY_USAGE,
  context: EMPTY_CONTEXT,
  workPhase: null,
};

// Transcripts are append-only and can be hundreds of MB; /api/session/:id is hit on every
// window focus and by each grid cell as turns finish, so re-reading + re-parsing the whole
// .jsonl each time blocked the event loop and janked the terminals. A (mtime,size) memo fixed the
// UNCHANGED case (#948) and left the one that hurts: a transcript being written to is changed on
// every turn, so an active 508 MB session paid a 10.5 s full read per turn. The fold is resumed
// instead, and kept beside a big file so a restart and the next process inherit it (#1377/#1386).
const isSessionUsage = (value: unknown): value is SessionUsage =>
  isRecord(value) &&
  typeof value.inputTokens === "number" &&
  typeof value.outputTokens === "number" &&
  typeof value.cacheReadTokens === "number" &&
  typeof value.cacheCreationTokens === "number";

const isPromptTrail = (value: unknown): value is PromptTrail =>
  isRecord(value) && [value.meaningful, value.latest, value.record].every((v) => v === null || typeof v === "string");

const isSummaryState = (value: unknown): value is SummaryState =>
  isRecord(value) &&
  isSessionUsage(value.usage) &&
  typeof value.userTurns === "number" &&
  (value.aiTitle === null || typeof value.aiTitle === "string") &&
  isPromptTrail(value.prompts) &&
  (value.lastAssistantText === null || typeof value.lastAssistantText === "string") &&
  isRecord(value.context) &&
  (value.context.model === null || typeof value.context.model === "string") &&
  typeof value.context.contextTokens === "number" &&
  Array.isArray(value.turnTools) &&
  value.turnTools.every((tool) => typeof tool === "string");

const summaryFold = createTranscriptFold<SummaryState>({
  kind: "summary",
  version: 1,
  isValue: isSummaryState,
  empty: emptySummaryState,
  fold: foldSummary,
  copy: copySummaryState,
});

export async function readSessionSummary(cwd: string, id: string): Promise<SessionSummary> {
  const file = path.join(projectSessionsDir(cwd), `${id}.jsonl`);
  try {
    const st = await fs.stat(file);
    const parts = summaryPartsOf(await summaryFold.read(file, { mtimeMs: st.mtimeMs, size: st.size }), LAST_RESPONSE_MAX);
    return {
      lastPrompt: parts.lastPrompt,
      aiTitle: parts.aiTitle,
      lastResponse: parts.lastResponse,
      userTurns: parts.userTurns,
      usage: parts.usage,
      context: parts.context,
      workPhase: classifyWorkPhase(parts.toolNames),
    };
  } catch {
    return EMPTY_SUMMARY; // no transcript on disk yet, or it could not be read
  }
}

// The tool-activity timeline for a session, capped to the most recent events so the
// payload stays bounded on a long session. A missing transcript is an empty list.
const TIMELINE_MAX_EVENTS = 300;

// `total` is not the length of `events` — it counts every event the transcript ever had, which is
// the only thing that can answer "was this truncated?" once the window has dropped the rest.
interface TimelineScan {
  events: TimelineEvent[];
  total: number;
}

const isTimelineEvent = (value: unknown): value is TimelineEvent =>
  isRecord(value) && typeof value.ts === "string" && typeof value.tool === "string" && typeof value.summary === "string";

const isTimelineScan = (value: unknown): value is TimelineScan =>
  isRecord(value) && typeof value.total === "number" && Array.isArray(value.events) && value.events.every(isTimelineEvent);

function foldTimeline(into: TimelineScan, record: Record<string, unknown>): void {
  for (const event of timelineEventsIn(record)) {
    into.total += 1;
    into.events.push(event);
    if (into.events.length > TIMELINE_MAX_EVENTS) into.events.shift();
  }
}

// Streamed since #998, and folded once since #1386: the payload was already capped, so reading the
// whole transcript to throw most of it away was the expensive part — and doing that again on every
// open of the overlay was the rest of it. The window is not a shortcut here: every record is still
// folded, the newest 300 are simply the only ones kept.
const timelineFold = createTranscriptFold<TimelineScan>({
  kind: "timeline",
  version: 1,
  isValue: isTimelineScan,
  empty: () => ({ events: [], total: 0 }),
  fold: foldTimeline,
  // The events ARRAY too, not just the record around it: a resumed fold pushes into it, and the
  // value it copied from has already been handed to a caller.
  copy: (scan) => ({ events: [...scan.events], total: scan.total }),
});

export async function sessionTimeline(cwd: string, id: string): Promise<{ events: TimelineEvent[]; truncated: boolean }> {
  const file = path.join(projectSessionsDir(cwd), `${id}.jsonl`);
  try {
    const st = await fs.stat(file);
    const scan = await timelineFold.read(file, { mtimeMs: st.mtimeMs, size: st.size });
    return { events: scan.events, truncated: scan.total > TIMELINE_MAX_EVENTS };
  } catch {
    return { events: [], truncated: false };
  }
}

// A session's last COMPLETED exchange, read from whichever log its agent keeps: Claude's
// per-project transcript, or codex's rollout. A codex session is addressed here by the
// mulmoterminal key the browser knows; the rollout it maps to is the one we recorded at
// spawn, or the key itself when it came from the sidebar (which lists rollout ids).
async function codexLastTurn(sessionKey: string): Promise<LastTurn> {
  // The mapping is read off disk, so a request served during startup would see an empty map and
  // fall through to the key — which is a mulmoterminal id, names no rollout, and reads as a
  // session with no last turn at all.
  await codexRolloutsHydrated;
  const rolloutId = codexRollouts.get(sessionKey)?.conversationId ?? sessionKey;
  const file = codexRolloutPath(codexSessionsRoot(), rolloutId);
  if (!file) return EMPTY_TURN;
  try {
    // Same reasoning as the Claude path below: the newest turn is at the end, so a rollout that
    // grew past what a string can hold no longer takes the feature with it (#998).
    return lastTurnFromCodexRolloutDocs(readTailRecords(file));
  } catch {
    return EMPTY_TURN;
  }
}

/** A cursor session's last complete exchange, from the transcript in its project directory.
 *
 *  The tail, for codex's reason: a transcript is a whole conversation with no bound, and the newest
 *  turn is at its end. The file is found by asking each of the cwd's project directories, because
 *  the slug one is named by cannot be reconstructed (cursor-sessions.ts). */
async function cursorLastTurn(cwd: string, id: string): Promise<LastTurn> {
  const file = await cursorTranscriptPath(cwd, id);
  if (!file) return EMPTY_TURN;
  try {
    return cursorLastTurnFromRecords(readTailRecords(file));
  } catch {
    return EMPTY_TURN;
  }
}

// The tail, not the whole file — which is what #865 said the fix would be and #998 forced.
//
// Reading it whole cost its full size: measured over 10,506 real transcripts the median is 0.1 MB,
// but 13 exceed 100 MB, the largest is 585 MB, and a 440 MB one took 1930 ms to yield a
// 334-character reply — 1.9 seconds with the event loop stopped, every terminal in the app frozen.
// Past ~512 MB the read could not complete at all (V8's maximum string length), so the button did
// nothing. The last turn is in the last few lines either way, so the size of the file behind it
// stopped mattering: the same read now costs 256 KB whatever the transcript weighs. There is
// consequently no size limit here at all, and no "too large" answer for a caller to handle.

export async function sessionLastTurn(cwd: string, id: string, agent: TerminalAgent): Promise<LastTurn> {
  if (agent === "codex") return codexLastTurn(id);
  if (agent === "cursor") return cursorLastTurn(cwd, id);
  // Everything that is not claude answers EMPTY_TURN, rather than the three agents that were true
  // when this was written. Each of them HAS a log — agy's brain directory, grok's
  // `chat_history.jsonl`, muse's `session.jsonl`, copilot's `turns` table — and none is parsed yet;
  // EMPTY_TURN is the honest answer until one is, because every caller handles it (a push says
  // nothing rather than something wrong, a handoff carries no reply) and a wrong guess at a format
  // would be worse than silence.
  //
  // Stated as "not claude" because the enumeration was WRONG the moment a sixth agent arrived:
  // copilot fell past it into claude's transcript read, keyed by a uuid that is not in claude's
  // project directory. It answered EMPTY by accident rather than on purpose, which is not the same
  // thing and would not have survived the first agent whose ids collided.
  if (agent !== "claude") return EMPTY_TURN;
  try {
    return lastTurnFromClaudeParsed(readTailRecords(path.join(projectSessionsDir(cwd), `${id}.jsonl`)));
  } catch {
    return EMPTY_TURN; // no transcript on disk yet
  }
}

// The prompts the USER gave a session, newest last — the pane beside the enlarged cell (#1748).
// Agent-branched exactly like sessionLastTurn above, and reading the same bounded tail: claude's
// history file is 8 MB on this machine and only ever appended to, so the default 4 MB window
// reaches ~15,000 recent submissions whatever it grows to.
//
// Each reader collects at PROMPT_SCAN_LIMIT and hands the result to promptWindow, which is where
// the cap and the "there are older ones" answer are decided together.
export type SessionPrompts = PromptWindow;

const NO_PROMPTS: SessionPrompts = { prompts: [], truncated: false };

// The transcript is the fallback rather than the source: it drops a prompt sent mid-turn and keeps
// text a skill injected (#1748), so it answers only when the history file had nothing to say —
// upstream changed the format, or the session predates it.
//
// Not for a CLEARED session. `${id}.jsonl` then holds the conversation the user ended, and every
// reader of that file asks this set first (#1085) — a fallback is not a reason to be the one that
// puts the ended conversation back on screen.
function claudeTranscriptPrompts(cwd: string, id: string): SessionPrompts {
  if (clearedTranscripts.has(id)) return NO_PROMPTS;
  try {
    return promptWindow(transcriptPrompts(readTailRecords(path.join(projectSessionsDir(cwd), `${id}.jsonl`)), PROMPT_SCAN_LIMIT));
  } catch {
    return NO_PROMPTS;
  }
}

// Under whichever id claude currently calls itself as well as ours — history.jsonl keys on
// claude's, and a `/clear` re-mints it (historyIdsFor).
//
// STREAMED, not a tail read, and the difference is the whole feature. The tail is right for a
// transcript, which is one file per session — its last 4 MB really are that session's recent turns.
// This file is one per USER: its last 4 MB are EVERYONE's recent prompts, so a session whose
// activity is a few days old falls outside the window entirely and reads as empty. Measured on this
// machine before the fix: 254 sessions had prompts on disk that the pane showed as 0, the worst of
// them 848 prompts (reported by the owner, who opened the pane and saw nothing).
//
// The cost is the file's LENGTH, not its content: the reader never materialises it and the scan
// keeps a sliding window of PROMPT_SCAN_LIMIT entries.
//
// RESUMED across reads, because the file is append-only (#1750): the first read of a session walks
// the whole 7.8 MB, and every read after it folds only the bytes written since. An open pane
// refreshes on every prompt submitted, so that steady state is what the user actually pays.
// prompt-history-memo.ts decides when a memo may be believed; here it is only stored and used.
const historyMemos = new Map<string, HistoryMemo>(); // our session id -> its last scan

export function forgetHistoryMemo(id: string): void {
  historyMemos.delete(id);
}

/** The fingerprint of the bytes ending at `offset`, or null when the file cannot supply them.
 *
 *  Null is the answer for a file shorter than the offset — truncated, rotated, or replaced by a
 *  smaller one — and for one that cannot be read at all. `offset === 0` has no bytes before it and
 *  needs no proof. */
/** The anchor at a byte offset of an OPEN file — see anchorOf for what the two windows are.
 *
 *  Takes the handle rather than the path, and every read of one scan goes through the same one. A
 *  path is re-resolved per read, so the fold and the anchor stored beside its window could describe
 *  two different files: the window from the one that was there for the fold, the anchor from
 *  whatever the path pointed at a millisecond later. That memo then passes its own check on every
 *  later read, so it is a poisoned cache rather than one wrong answer, and no amount of re-reading
 *  the path can tell — a replacement built to keep the first bytes intact is identical to the
 *  original from the outside (CodeRabbit, #1750). A handle IS the file it opened. */
async function anchorAt(handle: FileHandle, offset: number): Promise<string | null> {
  if (offset === 0) return EMPTY_ANCHOR;
  const readAt = async (from: number, want: number): Promise<Buffer | null> => {
    const buf = Buffer.alloc(want);
    const { bytesRead } = await handle.read(buf, 0, want, from);
    return bytesRead === want ? buf : null;
  };
  // The head is capped by the offset itself: a resume point inside the first ANCHOR_BYTES makes
  // the two windows overlap, which costs nothing and stays correct.
  const head = await readAt(0, Math.min(ANCHOR_BYTES, offset));
  const tailFrom = Math.max(0, offset - ANCHOR_BYTES);
  const tail = await readAt(tailFrom, offset - tailFrom);
  return head && tail ? anchorOf(head, tail) : null;
}

/** One attempt: plan from the memo, fold the range, and confirm the file did not change underneath.
 *
 *  Null means it DID, and the caller retries once from scratch. What "the file" means here is the
 *  handle opened on the first line: the plan, the fold and the stored anchor all read through it, so
 *  they cannot disagree about which file they saw however the PATH moves while they run. What is
 *  left is a file mutated in place under that handle — the fold's bytes and the anchor's would then
 *  differ, which the re-check below turns into a discard rather than a memo. */
async function scanHistoryOnce(id: string, ids: readonly string[], since: number | undefined, key: string, memo: HistoryMemo | undefined) {
  const handle = await fsSync.promises.open(claudeHistoryFile(), "r");
  try {
    const now = Date.now();
    const plan = resumePlan(memo, key, memo ? await anchorAt(handle, memo.offset) : null, now);
    // What the fold is about to consume, pinned at a byte it will pass: the resume point when there
    // is one, and otherwise the end as it stands right now. Re-read after the fold, it is what says
    // the file was not rewritten UNDER the handle while the fold ran — the one thing holding it open
    // cannot answer by itself. A fresh scan needs its own, since it has no memo anchor to re-check
    // and would otherwise store a window from before the rewrite beside an anchor from after it
    // (CodeRabbit, #1750).
    const checkpoint = plan.reuse ? plan.from : (await handle.stat()).size;
    const startedOn = plan.reuse && memo ? memo.anchor : await anchorAt(handle, checkpoint);
    // COPIED, never folded into in place: the memo is shared, so two overlapping reads of this
    // session would otherwise interleave into one array and count every appended prompt twice.
    const scan = plan.reuse ? copyClaudePromptScan(plan.reuse) : claudePromptScan(ids, PROMPT_SCAN_LIMIT, since);
    // `atLineStart` is what makes a resume safe: the offset came from a previous scan of this same
    // file, so it IS a line boundary and its record must be folded rather than dropped as a partial.
    const offset = await forEachJsonlRecordIn(handle, { from: plan.from, atLineStart: true }, (record) => foldClaudePrompt(scan, record));
    const anchor = await anchorAt(handle, offset);
    if (anchor === null) return null; // the file lost bytes this very scan consumed
    // EVERYTHING the memo will hold has now been read, and only then is the checkpoint re-read. That
    // order is the rule, not a detail: a validation placed before the last of those reads leaves the
    // gap it was meant to close — the rewrite simply lands after the check and before the anchor,
    // and the memo pairs a window from before it with an anchor from after (CodeRabbit, #1750). A
    // rewrite after this line is not a poisoned memo but a stale one, self-consistent about a state
    // the file has left, which the next read's own check discards.
    if (startedOn === null || (await anchorAt(handle, checkpoint)) !== startedOn) return null;
    // The full scan underneath is THIS one when nothing was carried, and otherwise the one the
    // carried window was built by — a resume extends a chain, it does not restart its clock.
    const fullScanAt = plan.reuse && memo ? memo.fullScanAt : now;
    historyMemos.set(id, { key, offset, anchor, scan, fullScanAt });
    return scan;
  } finally {
    await handle.close();
  }
}

async function claudePrompts(cwd: string, id: string): Promise<SessionPrompts> {
  // The live mapping first — any hook re-learns it, so it is the fresher of the two. The durable
  // one is what a RESTART leaves standing: without it the pane would know where the boundary is and
  // not which id the conversation past it is filed under, which shows nothing at all (#1749).
  const ids = historyIdsFor(id, claudeSessionIds.get(id) ?? clearedClaudeIdOf(id));
  const since = clearedAtOf(id);
  const key = memoKeyFor(ids, since);
  try {
    // Twice at most. The retry carries NO memo, so it is a full scan of whatever is there now —
    // the file that replaced the first attempt's. A second replacement inside that window would
    // discard again, and rather than loop we answer from the transcript: a bounded wrong-free path
    // beats an unbounded right one on a read that runs behind an open pane.
    const scan = (await scanHistoryOnce(id, ids, since, key, historyMemos.get(id))) ?? (await scanHistoryOnce(id, ids, since, key, undefined));
    if (scan && scan.found.length > 0) return promptWindow(scan.found);
  } catch {
    // No history file, or one this could not read — the transcript still knows something.
  }
  return claudeTranscriptPrompts(cwd, id);
}

async function codexSessionPrompts(sessionKey: string): Promise<SessionPrompts> {
  // Same hydration wait and same key→rollout resolution as codexLastTurn: a request served during
  // startup would otherwise read the mulmoterminal id as a rollout name and find nothing.
  await codexRolloutsHydrated;
  const rolloutId = codexRollouts.get(sessionKey)?.conversationId ?? sessionKey;
  const file = codexRolloutPath(codexSessionsRoot(), rolloutId);
  if (!file) return NO_PROMPTS;
  // Streamed for the same reason claude's history is: a rollout is one file per conversation, so a
  // tail read at least stays inside the right session — but a long one still loses its early
  // prompts, and three rollouts on this machine are already past the window (#1749).
  const scan = codexPromptScan(PROMPT_SCAN_LIMIT);
  try {
    await forEachJsonlRecord(file, (record) => foldCodexPrompt(scan, record));
    return promptWindow(scan.found);
  } catch {
    return NO_PROMPTS;
  }
}

export async function sessionPrompts(cwd: string, id: string, agent: TerminalAgent): Promise<SessionPrompts> {
  if (agent === "codex") return codexSessionPrompts(id);
  // The three agents sessionLastTurn cannot read either: their logs are real files in formats
  // nothing here parses, and an empty list is the honest answer until one of them is.
  if (agent !== "claude") return NO_PROMPTS; // see sessionLastTurn: stated as "not claude", not as a list
  return claudePrompts(cwd, id);
}

// The reply to the turn that just ENDED, for the phone push — null when that turn produced none,
// never an older exchange (#1650, which is the invariant readLatestResponse states above and this
// path was breaking). Reads the same tail as sessionLastTurn, and differs only in which turn it
// will speak for.
//
// Claude only: codex reaches the same push from codex-activity-track, which decides a turn ended by
// reading the very record that carries its reply, so its trigger cannot outrun its own data.
export async function claudeCurrentTurnReply(cwd: string, id: string): Promise<string | null> {
  try {
    return currentTurnReplyFromClaudeParsed(readTailRecords(path.join(projectSessionsDir(cwd), `${id}.jsonl`)));
  } catch {
    return null; // no transcript on disk yet
  }
}

// The three fields the session list needs OFF DISK. Cached; everything else on a row (the memo, the
// live ai-title, the activity flags) is read per request from memory, because those change while
// the file does not — caching the finished row would freeze an edited memo behind it.
interface TitleFields {
  aiTitle: string | null;
  lastPrompt: string | null;
  firstUserMsg: string | null;
}

const NO_TITLE_FIELDS: TitleFields = { aiTitle: null, lastPrompt: null, firstUserMsg: null };

// The rule, in one place, so the whole-file read and the resumed one cannot drift apart: the LAST
// ai-title / last-prompt win, the FIRST user message does.
function foldTitleField(into: TitleFields, o: Record<string, unknown>): void {
  if (o.type === "ai-title" && o.aiTitle) into.aiTitle = readString(o.aiTitle);
  else if (o.type === "last-prompt" && o.lastPrompt) into.lastPrompt = readString(o.lastPrompt);
  else if (o.type === "user" && into.firstUserMsg === null) {
    into.firstUserMsg = userPromptText(isRecord(o.message) ? o.message.content : undefined);
  }
}

// Windows for the cold read, measured over the 60 largest transcripts on a working machine (5 MB to
// 508 MB, each read end to end): the first `user` record sat at most 26.6 KB in, and the last
// ai-title / last-prompt at most 52.8 KB from EOF. Both windows are ~10x that, and a file whose
// fields fall outside them is not guessed at — the fold reads the whole file instead.
const TITLE_HEAD_BYTES = 256 * 1024;
const TITLE_TAIL_BYTES = 512 * 1024;

// The same three fields, folded once per file: an unchanged transcript is not read at all, a grown
// one costs only the bytes that arrived, and the answer is kept beside a big file so a restart and
// the next process do not pay for it again (#1377, #1386). Bump the version when foldTitleField
// changes what it means, or old sidecars answer for a rule that no longer exists.
const isTitleFields = (value: unknown): value is TitleFields =>
  isRecord(value) &&
  (value.aiTitle === null || typeof value.aiTitle === "string") &&
  (value.lastPrompt === null || typeof value.lastPrompt === "string") &&
  (value.firstUserMsg === null || typeof value.firstUserMsg === "string");

const titleFieldsFold = createTranscriptFold<TitleFields>({
  kind: "title-fields",
  version: 1,
  isValue: isTitleFields,
  empty: () => ({ ...NO_TITLE_FIELDS }),
  fold: foldTitleField,
  copy: (fields) => ({ ...fields }),
  cold: coldTitleFields,
});

// The first read of a file: both ends when it is big enough for that to be worth it, and the whole
// file when it is not — or when the ends did not answer. A field missing from a window is
// indistinguishable from a field the file never had, so the windows are a fast path, never the
// answer: only when all three are found is the fold provably the same as the whole-file one (the
// tail runs to EOF, so an ai-title found there IS the last one).
//
// The offset comes back with the fields, and it is the end of the last COMPLETE line rather than
// the file's size: a transcript caught mid-append ends in half a record, and resuming past it would
// start the next scan inside a line — losing the record that half line becomes.
async function coldTitleFields(full: string, size: number): Promise<FoldedAt<TitleFields> | null> {
  if (size > TITLE_HEAD_BYTES + TITLE_TAIL_BYTES) {
    const head: TitleFields = { ...NO_TITLE_FIELDS };
    const tail: TitleFields = { ...NO_TITLE_FIELDS };
    await forEachJsonlRecordIn(full, { to: TITLE_HEAD_BYTES }, (o) => foldTitleField(head, o));
    const offset = await forEachJsonlRecordIn(full, { from: size - TITLE_TAIL_BYTES }, (o) => foldTitleField(tail, o));
    if (head.firstUserMsg !== null && tail.aiTitle !== null && tail.lastPrompt !== null) {
      return { value: { aiTitle: tail.aiTitle, lastPrompt: tail.lastPrompt, firstUserMsg: head.firstUserMsg }, offset };
    }
  }
  return null; // the ends did not answer — the caller folds the whole file
}

export async function readSessionMeta(dir: string, file: string): Promise<SessionMeta> {
  const full = path.join(dir, file);
  const stat = await fs.stat(full);
  const { aiTitle, lastPrompt, firstUserMsg } = await titleFieldsFold.read(full, { mtimeMs: stat.mtimeMs, size: stat.size });

  const id = path.basename(file, ".jsonl");
  const title = sessionListTitle({ memo: sessionMemos.get(id), liveAiTitle: aiTitles.get(id), diskAiTitle: aiTitle, diskLastPrompt: lastPrompt, firstUserMsg });
  const a = activity.get(id);
  return {
    id,
    title,
    mtime: stat.mtimeMs,
    working: a?.working ?? false,
    waiting: a?.waiting ?? false,
    event: a?.event ?? null,
    hidden: isBackgroundSession(id),
    failed: isFailedWorker(id),
  };
}

// Cheap recency pass: stat (don't read) every session file just for its mtime, so the
// list can be ranked by recency. Files that vanished between readdir and stat are skipped.
export async function collectOnDiskSessionStats(dir: string, files: string[]): Promise<DiskStat[]> {
  const stats = await Promise.all(
    files.map(async (file): Promise<DiskStat | null> => {
      try {
        const st = await fs.stat(path.join(dir, file));
        return { kind: "disk", id: path.basename(file, ".jsonl"), file, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  return stats.filter((s): s is DiskStat => s !== null);
}

// In-memory sessions not yet written to disk. Prune (delete from knownSessions) any that
// have since been persisted — the on-disk record (with its real title) wins.
export function collectPendingSessions(onDisk: Set<string>, includePending: boolean): PendingSession[] {
  const known = includePending ? knownSessions : [];
  const { keep, persisted } = partitionPending(
    known,
    onDisk,
    (id) => activity.get(id),
    (id) => isBackgroundSession(id),
  );
  persisted.forEach((id) => knownSessions.delete(id));
  return keep;
}
