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
import { existsSync, readdirSync } from "node:fs";
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
import { activity, aiTitles, codexRollouts, codexRolloutsHydrated, isBackgroundSession, isFailedWorker, knownSessions, sessionMemos } from "./registry.js";
import { transcriptFile } from "./transcript-locate.js";
import { lastTurnFromClaudeParsed, lastTurnFromCodexRolloutDocs, EMPTY_TURN, type LastTurn } from "./last-turn.js";
import { forEachJsonlRecordIn, readTailRecords } from "../infra/jsonl-file.js";
import { copySummaryState, emptySummaryState, foldSummary, summaryPartsOf, type SummaryState } from "./summary-scan.js";
import { partitionPending } from "./partitionPending.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutPath } from "../agents/codex-sessions.js";
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
    const text = latestAssistantTextFromParsed(readTailRecords(transcriptFile(id, cwd)));
    return text ? text.slice(0, LAST_RESPONSE_MAX) : null;
  } catch {
    return null; // no transcript yet / unreadable
  }
}

// Whether a session has an on-disk transcript (claude only writes it after the
// first prompt) in the given workspace. Determines whether `--resume` will work.
export function sessionExistsOnDisk(id: string, cwd: string): boolean {
  return existsSync(transcriptFile(id, cwd));
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
    return latestMeaningfulUserPromptFromParsed(readTailRecords(transcriptFile(id, cwd)));
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
  const file = transcriptFile(id, cwd);
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
  const file = transcriptFile(id, cwd);
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
  // Neither log is read yet, and each is a real file rather than a missing feature: agy's brain
  // directory, and grok's `chat_history.jsonl` under `~/.grok/sessions/<cwd>/<id>/`. EMPTY_TURN is
  // the honest answer for both until one is parsed — every caller already handles it (a push says
  // nothing rather than something wrong, a handoff carries no reply), which is why a wrong guess at
  // the format would be worse than silence.
  if (agent === "antigravity" || agent === "grok") return EMPTY_TURN;
  try {
    return lastTurnFromClaudeParsed(readTailRecords(transcriptFile(id, cwd)));
  } catch {
    return EMPTY_TURN; // no transcript on disk yet
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
