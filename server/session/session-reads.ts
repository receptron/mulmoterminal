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
import {
  isRecord,
  parseJsonl,
  userPromptText,
  aiTitleFromParsed,
  countUserTurnsFromParsed,
  latestMeaningfulUserPromptFromJsonl,
  latestMeaningfulUserPromptFromParsed,
  latestAssistantTextFromParsed,
  sessionUsageFromParsed,
  latestTurnContextFromParsed,
  timelineFromJsonl,
  currentTurnToolNamesFromParsed,
  type SessionUsage,
  type LatestTurnContext,
  type TimelineEvent,
} from "./transcript.js";
import { createFileCache, type FileStamp } from "./file-cache.js";
import { classifyWorkPhase, type WorkPhase } from "./workPhase.js";
import { activity, aiTitles, hiddenSessions, knownSessions } from "./registry.js";
import { projectSessionsDir } from "./project-dir.js";
import type { DiskStat, PendingSession, SessionMeta } from "./types.js";

// Bytes of an assistant reply kept for the roster; the same cap the push body uses.
export const LAST_RESPONSE_MAX = 400;

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
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    return latestMeaningfulUserPromptFromJsonl(raw);
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
  let records: Record<string, unknown>[];
  try {
    records = parseJsonl(await fs.readFile(file, "utf8"));
  } catch {
    return EMPTY_SUMMARY;
  }
  const summary: SessionSummary = {
    lastPrompt: latestMeaningfulUserPromptFromParsed(records),
    aiTitle: aiTitleFromParsed(records),
    lastResponse: latestAssistantTextFromParsed(records)?.slice(0, LAST_RESPONSE_MAX) ?? null,
    userTurns: countUserTurnsFromParsed(records),
    usage: sessionUsageFromParsed(records),
    context: latestTurnContextFromParsed(records),
    workPhase: classifyWorkPhase(currentTurnToolNamesFromParsed(records)),
  };
  sessionSummaryCache.set(file, stamp, summary);
  return summary;
}

// The tool-activity timeline for a session, capped to the most recent events so the
// payload stays bounded on a long session. A missing transcript is an empty list.
const TIMELINE_MAX_EVENTS = 300;
export async function sessionTimeline(cwd: string, id: string): Promise<{ events: TimelineEvent[]; truncated: boolean }> {
  try {
    const raw = await fs.readFile(path.join(projectSessionsDir(cwd), `${id}.jsonl`), "utf8");
    const all = timelineFromJsonl(raw);
    return { events: all.slice(-TIMELINE_MAX_EVENTS), truncated: all.length > TIMELINE_MAX_EVENTS };
  } catch {
    return { events: [], truncated: false };
  }
}

// Scan a session JSONL for a human-friendly title and last activity.
export async function readSessionMeta(dir: string, file: string): Promise<SessionMeta> {
  const full = path.join(dir, file);
  const [raw, stat] = await Promise.all([fs.readFile(full, "utf8"), fs.stat(full)]);

  let aiTitle: string | null = null;
  let lastPrompt: string | null = null;
  let firstUserMsg: string | null = null;

  for (const o of parseJsonl(raw)) {
    if (o.type === "ai-title" && o.aiTitle) aiTitle = String(o.aiTitle);
    else if (o.type === "last-prompt" && o.lastPrompt) lastPrompt = String(o.lastPrompt);
    else if (o.type === "user" && firstUserMsg === null) {
      firstUserMsg = userPromptText(isRecord(o.message) ? o.message.content : undefined);
    }
  }

  const id = path.basename(file, ".jsonl");
  // The live in-memory title (this process run) wins over the on-disk record.
  const title = aiTitles.get(id) || aiTitle || lastPrompt || firstUserMsg || "(untitled session)";
  const a = activity.get(id);
  return {
    id,
    title,
    mtime: stat.mtimeMs,
    working: a?.working ?? false,
    waiting: a?.waiting ?? false,
    event: a?.event ?? null,
    hidden: hiddenSessions.has(id),
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
  const pending: PendingSession[] = [];
  for (const [id, meta] of includePending ? knownSessions : []) {
    if (onDisk.has(id)) {
      knownSessions.delete(id);
      continue;
    }
    pending.push({
      kind: "pending",
      id,
      title: meta.title,
      mtime: meta.createdAt,
      working: activity.get(id)?.working ?? false,
      waiting: activity.get(id)?.waiting ?? false,
      event: activity.get(id)?.event ?? null,
      hidden: hiddenSessions.has(id),
    });
  }
  return pending;
}
