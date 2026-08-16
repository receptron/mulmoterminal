// The prompts the USER typed at a session, newest last — the other half of the activity
// timeline, which records what the agent ran rather than what it was asked for.
//
// Read from the log that holds what a person actually typed, which for claude is NOT its
// transcript. Measured on a real session (#1748): a prompt sent WHILE a turn was running is
// written to ~/.claude/history.jsonl within milliseconds but never appears in the transcript as a
// `type:"user"` record — it arrives as `queue-operation` / `attachment` — while the text a skill
// injects DOES appear there as a user record, and is not matched by isInjectedPrompt. So the
// transcript drops the interruptions (the very prompts a user forgets giving) and adds text nobody
// typed. history.jsonl carries one line per submission, and nothing else.
//
// Pure: the reading and the agent branch live in session-reads.ts.
import { isRecord } from "../../common/isRecord.js";
import { readString } from "../../common/readString.js";
import type { PromptEntry, PromptWindow } from "../../common/promptHistory.js";
import { codexEventPayload } from "../agents/codex-events.js";
import { userPromptText } from "./transcript.js";

/** Enough to recognise a prompt again, which is what this is for. Deliberately far above
 *  LAST_PROMPT_CAP (200): that one keeps a header to one line, this one is read back. */
export const PROMPT_TEXT_CAP = 1000;

/** How many the pane is served. The ask was "10, maybe 20"; the rest is scrollback. */
export const PROMPT_HISTORY_MAX = 100;

/** What a READER should ask for: one over the window, so overflow is a fact rather than an
 *  inference. Cap at exactly PROMPT_HISTORY_MAX and a session with precisely that many prompts is
 *  indistinguishable from one that had a thousand — and the pane would tell a complete list that
 *  its older prompts are missing (Codex, #1749). */
export const PROMPT_SCAN_LIMIT = PROMPT_HISTORY_MAX + 1;

/** The served window, from what a reader collected at PROMPT_SCAN_LIMIT. */
export const promptWindow = (found: PromptEntry[]): PromptWindow => ({
  prompts: found.slice(-PROMPT_HISTORY_MAX),
  truncated: found.length > PROMPT_HISTORY_MAX,
});

const cap = (text: string): string => (text.length > PROMPT_TEXT_CAP ? `${text.slice(0, PROMPT_TEXT_CAP)}…` : text);

// Trivial acks ("ok", "はい") are kept. isTrivialPrompt also calls "merge" / "続けて" trivial —
// correct for a header, which wants the task, and wrong here, where those ARE the instruction.
const entry = (at: number | null, text: unknown): PromptEntry | null => {
  const body = readString(text).trim();
  return body ? { at, text: cap(body) } : null;
};

/** Epoch ms from either shape the two logs use: claude's number, codex's ISO string. */
function epochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/** One ~/.claude/history.jsonl line: `{display, timestamp, project, sessionId}`. The session id is
 *  required — it is what scopes the file to one cell — and a record without it is dropped rather
 *  than shown under whichever session happens to be asking. */
export function claudeHistoryPrompt(record: Record<string, unknown>): { sessionId: string; prompt: PromptEntry } | null {
  const sessionId = readString(record.sessionId);
  if (!sessionId) return null;
  const prompt = entry(epochMs(record.timestamp), record.display);
  return prompt ? { sessionId, prompt } : null;
}

/** What a reader carries while it walks a log: the newest `limit` matches so far.
 *
 *  A sliding window, so the cost is the log's LENGTH and never its content — a session with
 *  thousands of prompts holds `limit` of them. That is what lets these logs be STREAMED rather than
 *  tail-read, which is the difference between showing a long-running session's prompts and showing
 *  nothing (#1749). */
export interface PromptScan {
  limit: number;
  found: PromptEntry[];
}

const keepNewest = (scan: PromptScan, prompt: PromptEntry | null): void => {
  if (!prompt) return;
  scan.found.push(prompt);
  if (scan.found.length > scan.limit) scan.found.shift();
};

// The readers below differ only in which records they recognise; keeping the WINDOW in one place is
// what makes "oldest first, newest `limit` kept" the same answer for every log.
const collect = (records: Record<string, unknown>[], read: (record: Record<string, unknown>) => PromptEntry | null, limit: number): PromptEntry[] => {
  const scan: PromptScan = { limit, found: [] };
  records.forEach((record) => keepNewest(scan, read(record)));
  return scan.found;
};

/** Which ids the history file has to be read under, for a session this app calls `ourId`.
 *
 *  Ours, plus the id claude reports for ITSELF when that differs. `/clear` is why the second one
 *  exists: cleared-transcripts.ts records (from #1085) that claude mints a new id there while its
 *  hooks keep reporting under ours, so history.jsonl — which keys on claude's — would stop
 *  matching. One extra id, not a chain.
 *
 *  `/compact` does NOT belong on that list, though the comment above resolveHookSessionId says it
 *  does. Measured over every compacted transcript on this machine: 95 compacted, 61 of them had
 *  prompts afterwards, and in **all 61 the session id was unchanged** — auto and manual alike. A
 *  chain of ids was built for that case and removed again; do not add it back without measuring
 *  first, and if a future claude does reissue on compact, the fix is here rather than in a
 *  persisted log (#1749). */
export const historyIdsFor = (ourId: string, claudeId: string | undefined): string[] => (!claudeId || claudeId === ourId ? [ourId] : [ourId, claudeId]);

/** A claude scan also carries WHICH session it is looking for and where the `/clear` boundary is. */
export interface ClaudePromptScan extends PromptScan {
  wanted: Set<string>;
  since: number | undefined;
}

export const claudePromptScan = (sessionIds: readonly string[], limit: number = PROMPT_HISTORY_MAX, since?: number | undefined): ClaudePromptScan => ({
  wanted: new Set(sessionIds),
  since,
  limit,
  found: [],
});

/** Fold one history record into the scan. The rule lives here and the array reader below goes
 *  through the same one, so a streamed read and an array read cannot answer differently. */
export function foldClaudePrompt(scan: ClaudePromptScan, record: Record<string, unknown>): void {
  const read = claudeHistoryPrompt(record);
  keepNewest(scan, read && scan.wanted.has(read.sessionId) && afterFloor(read.prompt, scan.since) ? read.prompt : null);
}

/** The codex equivalent. A rollout is one file per conversation, so it needs no session filter —
 *  but it still has to be STREAMED: three of the 2,586 rollouts on this machine are past the 4 MB
 *  tail window, and the largest would have shown 5 of its 9 prompts (#1749). */
export const codexPromptScan = (limit: number = PROMPT_HISTORY_MAX): PromptScan => ({ limit, found: [] });

export function foldCodexPrompt(scan: PromptScan, record: Record<string, unknown>): void {
  const payload = codexEventPayload(record, "user_message");
  keepNewest(scan, payload ? entry(epochMs(record.timestamp), payload.message) : null);
}

/** These ids' prompts, oldest first, capped to the newest `limit`. Several ids are ONE session
 *  whose id was reissued mid-conversation, so the rows interleave in file order — which is time
 *  order, since the file is only ever appended to.
 *
 *  Takes an ARRAY, so it is the shape a test can drive; the server streams instead (see
 *  session-reads.ts) because this file is shared by every session and a tail read of it silently
 *  loses whole conversations. */
export function claudePromptsFor(
  records: Record<string, unknown>[],
  sessionIds: readonly string[],
  limit: number = PROMPT_HISTORY_MAX,
  since?: number | undefined,
): PromptEntry[] {
  const scan = claudePromptScan(sessionIds, limit, since);
  records.forEach((record) => foldClaudePrompt(scan, record));
  return scan.found;
}

/** Whether a prompt belongs to the conversation running NOW. `since` is set only for a session
 *  that was `/clear`ed: everything before that moment belongs to the conversation the user ended,
 *  and the rest of the app already refuses to show it (#1085) — the header, the title and the last
 *  reply are all blanked there, so the pane may not be the one surface that keeps it (Codex,
 *  #1749).
 *
 *  A TIME floor rather than dropping our own session id, because whether `/clear` re-mints claude's
 *  id is not something this repo has measured — and the id-based version fails closed if it does
 *  not, leaving the pane permanently empty. A floor is right either way.
 *
 *  A prompt whose own time could not be read is dropped under a floor: it cannot be SHOWN to be
 *  after the clear, and the boundary is a promise rather than a preference. Without a floor it is
 *  kept, since there is then nothing it could be on the wrong side of. */
const afterFloor = (prompt: PromptEntry, since: number | undefined): boolean => since === undefined || (prompt.at !== null && prompt.at >= since);

/** codex has no history file and no hooks, so its rollout is the only record of a prompt. The
 *  `user_message` events are the ones a person sent: measured over 40 real rollouts, none of them
 *  carried injected text (codex files its environment context under other payload types).
 *
 *  Through the same fold the server streams, so what a test drives is what production runs. */
export function codexPrompts(records: Record<string, unknown>[], limit: number = PROMPT_HISTORY_MAX): PromptEntry[] {
  const scan = codexPromptScan(limit);
  records.forEach((record) => foldCodexPrompt(scan, record));
  return scan.found;
}

/** The transcript fallback, so a history.jsonl this cannot read — a format change upstream, or a
 *  session claude wrote before that file existed — leaves the pane with SOMETHING rather than
 *  silently empty. Worse than the real thing by construction (it is missing the interruptions and
 *  carries injected text that `userPromptText` does not recognise), which is why it is the
 *  fallback and not the source. */
export const transcriptPrompts = (records: Record<string, unknown>[], limit: number = PROMPT_HISTORY_MAX): PromptEntry[] =>
  collect(
    records,
    (record) => {
      if (record.type !== "user" || !isRecord(record.message)) return null;
      const text = userPromptText(record.message.content);
      return text === null ? null : entry(epochMs(record.timestamp), text);
    },
    limit,
  );
