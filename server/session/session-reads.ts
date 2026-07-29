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
  type TimelineEvent,
} from "./transcript.js";
import { createFileCache, type FileStamp } from "./file-cache.js";
import { classifyWorkPhase, type WorkPhase } from "./workPhase.js";
import { sessionListTitle } from "./sessionListTitle.js";
import { activity, aiTitles, codexRolloutIds, isBackgroundSession, knownSessions, sessionMemos } from "./registry.js";
import { projectSessionsDir } from "./project-dir.js";
import { lastTurnFromClaudeParsed, lastTurnFromCodexRolloutDocs, EMPTY_TURN, type LastTurn } from "./last-turn.js";
import { forEachJsonlRecord, readTailRecords } from "../infra/jsonl-file.js";
import { createSummaryScan } from "./summary-scan.js";
import { partitionPending } from "./partitionPending.js";
import { codexSessionsRoot } from "../agents/codex-session.js";
import { codexRolloutPath } from "../agents/codex-sessions.js";
import type { DiskStat, PendingSession, SessionMeta } from "./types.js";

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
// .jsonl each time blocked the event loop and janked the terminals. Memoize by (mtime,size):
// an unchanged transcript returns instantly, and a changed one is read + parsed ONCE (the six
// derived values share one parse pass, vs. one parse per helper before).
const sessionSummaryCache = createFileCache<SessionSummary>();

export async function readSessionSummary(cwd: string, id: string): Promise<SessionSummary> {
  const file = path.join(projectSessionsDir(cwd), `${id}.jsonl`);
  let stamp: FileStamp;
  try {
    const st = await fs.stat(file);
    stamp = { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return EMPTY_SUMMARY; // no transcript on disk yet
  }
  const cached = sessionSummaryCache.get(file, stamp);
  if (cached) return cached;
  // Streamed, never held: the transcript reaches 585 MB here, which is past what one string can
  // be — and reading it whole is what emptied the longest sessions (#998).
  const scan = createSummaryScan();
  try {
    await forEachJsonlRecord(file, (record) => scan.add(record));
  } catch {
    return EMPTY_SUMMARY;
  }
  const parts = scan.finish(LAST_RESPONSE_MAX);
  const summary: SessionSummary = {
    lastPrompt: parts.lastPrompt,
    aiTitle: parts.aiTitle,
    lastResponse: parts.lastResponse,
    userTurns: parts.userTurns,
    usage: parts.usage,
    context: parts.context,
    workPhase: classifyWorkPhase(parts.toolNames),
  };
  sessionSummaryCache.set(file, stamp, summary);
  return summary;
}

// The tool-activity timeline for a session, capped to the most recent events so the
// payload stays bounded on a long session. A missing transcript is an empty list.
const TIMELINE_MAX_EVENTS = 300;
export async function sessionTimeline(cwd: string, id: string): Promise<{ events: TimelineEvent[]; truncated: boolean }> {
  // Streamed, and only the newest TIMELINE_MAX_EVENTS are kept — the payload was already capped,
  // so holding the whole transcript to then throw most of it away was the expensive part (#998).
  const events: TimelineEvent[] = [];
  let total = 0;
  try {
    await forEachJsonlRecord(path.join(projectSessionsDir(cwd), `${id}.jsonl`), (record) => {
      for (const event of timelineEventsIn(record)) {
        total += 1;
        events.push(event);
        if (events.length > TIMELINE_MAX_EVENTS) events.shift();
      }
    });
  } catch {
    return { events: [], truncated: false };
  }
  return { events, truncated: total > TIMELINE_MAX_EVENTS };
}

// A session's last COMPLETED exchange, read from whichever log its agent keeps: Claude's
// per-project transcript, or codex's rollout. A codex session is addressed here by the
// mulmoterminal key the browser knows; the rollout it maps to is the one we recorded at
// spawn, or the key itself when it came from the sidebar (which lists rollout ids).
async function codexLastTurn(sessionKey: string): Promise<LastTurn> {
  const rolloutId = codexRolloutIds.get(sessionKey) ?? sessionKey;
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
// stopped mattering: the same read now costs 256 KB whatever the transcript weighs.
//
// `LAST_TURN_MAX_BYTES` / `tooLarge` are consequently dead as a limit. They stay for now because
// `tooLarge` reaches the UI (useHandoff, codeBlockCopy) and removing a wire field is its own
// change; nothing sets it any more.
export const LAST_TURN_MAX_BYTES = 64 * 1024 * 1024;

export async function sessionLastTurn(cwd: string, id: string, agent: "claude" | "codex" | "antigravity"): Promise<LastTurn> {
  if (agent === "codex") return codexLastTurn(id);
  if (agent === "antigravity") return EMPTY_TURN;
  try {
    return lastTurnFromClaudeParsed(readTailRecords(path.join(projectSessionsDir(cwd), `${id}.jsonl`)));
  } catch {
    return EMPTY_TURN; // no transcript on disk yet
  }
}

// Scan a session JSONL for a human-friendly title and last activity.
export async function readSessionMeta(dir: string, file: string): Promise<SessionMeta> {
  const full = path.join(dir, file);

  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;
  let firstUserMsg: string | null = null;

  // Streamed like every other transcript reader (#998). This one was missed by that issue's own
  // table, which is a fair warning about how easy the whole-file read is to reach for: three
  // fields out of a file that reaches 585 MB, where reading it whole throws and the session list
  // then shows a title of "(no title)".
  const [, stat] = await Promise.all([
    forEachJsonlRecord(full, (o) => {
      if (o.type === "ai-title" && o.aiTitle) aiTitle = String(o.aiTitle);
      else if (o.type === "last-prompt" && o.lastPrompt) lastPrompt = String(o.lastPrompt);
      else if (o.type === "user" && firstUserMsg === null) {
        firstUserMsg = userPromptText(isRecord(o.message) ? o.message.content : undefined);
      }
    }),
    fs.stat(full),
  ]);

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
