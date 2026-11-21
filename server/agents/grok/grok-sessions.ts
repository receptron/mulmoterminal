// grok's own conversations for a working directory, newest first — the launcher's "or resume here"
// list when the Agent Picker is on Grok, mirroring `codex-sessions.ts` and `antigravity-sessions.ts`.
//
// It is the cheapest of the three, and for one reason: `~/.grok/sessions` is PARTITIONED BY
// WORKING DIRECTORY (`<encodeURIComponent(cwd)>/<uuid>/`), so a per-cwd listing is one readdir.
// codex has to scan a date tree and filter on the cwd it recorded; antigravity cannot answer the
// question at all without our own log. grok answers it with a directory name.
//
// The encoding of that directory name is the silent failure mode of this whole file: get it wrong
// and the listing is simply empty, with nothing logged and nothing thrown. It is not re-derived
// here — `encodeGrokCwd` next door was measured against a real session and has a spec pinning the
// space / slash / non-ASCII cases.
import { promises as fs } from "node:fs";
import path from "node:path";
import { isRecord } from "../../../common/isRecord.js";
import { byCodeUnit } from "../../../common/byCodeUnit.js";
import { cleanTitle, parseJsonRecord } from "../transcript-head.js";
import { readTailLines } from "../../infra/fs/jsonl-file.js";
import { encodeGrokCwd, isGrokConversationId } from "./grok-session.js";

const DEFAULT_TITLE = "Grok session";
const SCAN_LIMIT = 200; // newest conversation directories to open a summary for, per request
// The cwd's prompt_history.jsonl, read only as a TITLE FALLBACK. The tail, not the head: the rows
// being listed are the newest conversations, and this file is append-only for the lifetime of the
// directory — its head holds the oldest prompts, which belong to conversations that will never be
// on this page.
const PROMPT_HISTORY_TAIL_BYTES = 256 * 1024;

export interface GrokSessionSummary {
  id: string;
  title: string;
  mtime: number;
}

const grokCwdDir = (root: string, cwd: string): string => path.join(root, encodeGrokCwd(cwd));

export const grokSummaryPath = (root: string, cwd: string, id: string): string => path.join(grokCwdDir(root, cwd), id, "summary.json");

/** The conversation's current context reading, rewritten whole each turn (grok-usage.ts). */
export const grokSignalsPath = (root: string, cwd: string, id: string): string => path.join(grokCwdDir(root, cwd), id, "signals.json");

/** The conversation's append-only update stream, one `turn_completed` record per turn — the only
 *  place a per-turn token count is written down (grok-usage.ts). */
export const grokUpdatesPath = (root: string, cwd: string, id: string): string => path.join(grokCwdDir(root, cwd), id, "updates.jsonl");

/** The conversation itself, one message per line, appended as each step completes (grok-last-turn.ts). */
export const grokChatHistoryPath = (root: string, cwd: string, id: string): string => path.join(grokCwdDir(root, cwd), id, "chat_history.jsonl");

/** The first prompt of each conversation the cwd's prompt_history.jsonl still remembers.
 *
 *  FIRST, not last: it is standing in for a title, and a title is what the conversation was
 *  opened to do. The file is one line per prompt (`{ timestamp, session_id, prompt, is_bash }`)
 *  with every conversation in the directory interleaved, so "first" means the earliest surviving
 *  line for that id — which is what taking the first occurrence in file order gives.
 */
export function grokPromptTitles(root: string, cwd: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const line of readTailLines(path.join(grokCwdDir(root, cwd), "prompt_history.jsonl"), PROMPT_HISTORY_TAIL_BYTES)) {
    const record = parseJsonRecord(line);
    if (!record || typeof record.session_id !== "string" || typeof record.prompt !== "string") continue;
    // A `!` line is a shell command the user ran, not what the conversation is about.
    if (record.is_bash === true) continue;
    if (!titles.has(record.session_id)) titles.set(record.session_id, record.prompt);
  }
  return titles;
}

interface GrokSummary {
  title: string | null;
  mtime: number | null;
}

const isoMs = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/**
 * Title and recency out of one conversation's `summary.json`, or nulls when it cannot be used.
 *
 * `last_active_at` before `updated_at`, deliberately: grok rewrites `summary.json` when it
 * generates a title, hours after the conversation was last touched, so `updated_at` (and the
 * file's own mtime, which tracks it) sorts a dead conversation above a live one. `last_active_at`
 * is the last turn.
 *
 * The title is `generated_title` before `session_summary` — they are the same string once grok has
 * generated one, and only `session_summary` is ever written empty. Measured over 7 real
 * conversations on this machine: all 7 had a summary.json, 1 had neither title field, which is why
 * the fallback chain below is required rather than defensive.
 */
export function parseGrokSummary(text: string): GrokSummary {
  const doc = parseJsonRecord(text);
  if (!doc) return { title: null, mtime: null };
  const info = isRecord(doc.info) ? doc.info : {};
  return {
    title: nonEmpty(doc.generated_title) ?? nonEmpty(doc.session_summary) ?? nonEmpty(info.title),
    mtime: isoMs(doc.last_active_at) ?? isoMs(doc.updated_at) ?? isoMs(doc.created_at),
  };
}

/**
 * The model a conversation is running, from the same `summary.json`.
 *
 * `current_model_id` ("grok-4.5") is the only model grok records that a reader can trust: the
 * per-turn `model_id` in `events.jsonl` says the same thing but costs a scan of a file whose
 * phase_changed rows outnumber everything else 100:1. The token counts are NOT here — they are in
 * `signals.json` and `updates.jsonl`, read by grok-usage.ts, which is why this answers the model
 * alone.
 */
export const grokModelFromSummary = (text: string): string | null => {
  const doc = parseJsonRecord(text);
  return doc ? nonEmpty(doc.current_model_id) : null;
};

async function mtimeOf(target: string): Promise<number | null> {
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

async function readSummary(file: string): Promise<GrokSummary & { statMtime: number | null }> {
  try {
    const [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { ...parseGrokSummary(text), statMtime: stat.mtimeMs };
  } catch {
    // A conversation directory with no readable summary is KEPT, not dropped — grok creates the
    // directory before it first writes the file, so an unreadable summary means "just started" or
    // "the format moved", and a row under a default name is worth more than a listing that
    // silently loses the session the user is looking for. antigravity's lister makes the same call.
    return { title: null, mtime: null, statMtime: null };
  }
}

async function conversationIdsIn(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && isGrokConversationId(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}

/** The `scan` most recently touched conversation directories, by their own mtime.
 *
 *  Not by id: grok mints uuid v7 (whose prefix IS a timestamp) but directories written by older
 *  builds are v4, and this machine has both side by side — so sorting the names would order a
 *  mixed directory arbitrarily and the cap would drop whichever ids happened to sort low. Under
 *  the cap nothing is stat-ed at all; the sort only exists to decide what NOT to open.
 */
async function newestIds(dir: string, ids: string[], scan: number): Promise<string[]> {
  if (ids.length <= scan) return ids;
  const stamped = await Promise.all(
    ids.map(async (id) => {
      try {
        return { id, mtime: (await fs.stat(path.join(dir, id))).mtimeMs };
      } catch {
        return { id, mtime: 0 };
      }
    }),
  );
  return stamped
    .toSorted((a, b) => b.mtime - a.mtime || byCodeUnit(a.id, b.id))
    .slice(0, scan)
    .map((s) => s.id);
}

/**
 * grok conversations started in `cwd`, newest first.
 *
 * `SCAN_LIMIT` bounds the filesystem work, and unlike codex's window it costs nothing in accuracy
 * for a normal directory: the cap is on conversations in ONE working directory, not on every
 * conversation on the machine. A directory holding more than 200 loses the oldest of them from the
 * listing, which is the same trade the other two listers make.
 */
export async function listGrokSessions(root: string, cwd: string, limit: number): Promise<GrokSessionSummary[]> {
  const dir = grokCwdDir(root, cwd);
  const ids = await conversationIdsIn(dir);
  if (ids.length === 0) return [];
  // Only read prompt_history once, and only when there is something to title.
  const prompts = grokPromptTitles(root, cwd);
  const scanned = await newestIds(dir, ids, SCAN_LIMIT);
  const summaries = await Promise.all(
    scanned.map(async (id) => {
      const summary = await readSummary(grokSummaryPath(root, cwd, id));
      // The DIRECTORY's mtime is the last fallback, not zero: grok creates the directory before it
      // first writes a summary, so a conversation started seconds ago is exactly the one with no
      // readable summary — and stamping it 0 sorts it below every old row and straight out of the
      // `limit` (CodeRabbit / Codex on #1449). Only reached when the summary is unusable.
      const mtime = summary.mtime ?? summary.statMtime ?? (await mtimeOf(path.join(dir, id)));
      return {
        id,
        title: cleanTitle(summary.title ?? prompts.get(id) ?? null, DEFAULT_TITLE),
        mtime: mtime ?? 0,
      };
    }),
  );
  return summaries.toSorted((a, b) => b.mtime - a.mtime).slice(0, limit);
}
