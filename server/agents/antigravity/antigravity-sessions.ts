// agy's own conversations for a workspace, newest first — the per-project listing that makes a
// past Antigravity conversation findable and resumable, mirroring `/api/codex/sessions`.
//
// The cwd does NOT come from agy. `codex-sessions.ts` next door filters rollouts by the cwd codex
// records in its own session_meta; agy records a conversation's workspace in three places and none
// of them answers "every conversation in this directory": `cache/last_conversations.json` keeps
// only the LAST conversation per cwd and is written at exit, `history.jsonl` has no conversation
// id, and `conversation_summaries.db` has the columns but the CLI never writes a row. So the cwd
// is read from OUR log (session/list/agent-conversations.ts) and agy's transcript is opened only
// for a title and an mtime.
import path from "node:path";
import type { AgentConversation } from "../../session/list/agent-conversations.js";
import { antigravityConversationExists } from "./antigravity-session.js";
import { cleanTitle, parseJsonRecord, readTranscriptHead } from "../transcript-head.js";

const HEAD_BYTES = 64 * 1024; // the first user turn is step 0, so the head is all a title needs
const SCAN_LIMIT = 200; // newest conversations to touch the filesystem for per request
const DEFAULT_TITLE = "Antigravity session";

// agy wraps the prompt and appends its own blocks, so the raw `content` is not a title:
// `<USER_REQUEST>\n…\n</USER_REQUEST>` then `<ADDITIONAL_METADATA>` (local time) and
// `<USER_SETTINGS_CHANGE>` (a paragraph about the model the user picked).
const USER_REQUEST_RE = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/;
const APPENDED_BLOCK_RE = /<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE)>[\s\S]*?<\/\1>/g;

export interface AntigravitySessionSummary {
  id: string;
  title: string;
  mtime: number;
}

export function antigravityTranscriptPath(root: string, id: string): string {
  return path.join(root, id, ".system_generated", "logs", "transcript.jsonl");
}

// The user's first prompt. Steps that are not user input carry no `content` at all
// (`CONVERSATION_HISTORY`), so the type check alone is not enough.
const isUserInput = (d: Record<string, unknown>): boolean => d.type === "USER_INPUT" && typeof d.content === "string";

/** What the user typed, out of the wrapper agy stores a prompt in. */
export function antigravityPromptText(content: string): string {
  const wrapped = USER_REQUEST_RE.exec(content);
  // No wrapper means a shape we have not seen. Dropping the blocks we DO know keeps a usable
  // title instead of pasting agy's metadata into the row.
  return wrapped?.[1] ?? content.replace(APPENDED_BLOCK_RE, "");
}

/** The user's first prompt, from the head of a transcript, or null when it holds none yet.
 *
 *  Undefaulted, unlike the listing's title below: a roster row wants nothing rather than the words
 *  "Antigravity session", which say less than the blank line they would replace (#2123). */
export function antigravityPromptFromTranscriptHead(head: string): string | null {
  const first = head
    .split("\n")
    .map(parseJsonRecord)
    .find((d): d is Record<string, unknown> => d !== null && isUserInput(d));
  if (typeof first?.content !== "string") return null;
  return antigravityPromptText(first.content).trim() || null;
}

/** The conversation's title, from the head of its transcript. */
export function antigravityTitleFromTranscriptHead(head: string): string {
  return cleanTitle(antigravityPromptFromTranscriptHead(head), DEFAULT_TITLE);
}

// The model the conversation is running, out of the same block the title has to strip.
//
// It reads as prose written only on a CHANGE ("The user changed setting `Model Selection` from
// None to Gemini 3.6 Flash (High)."), and that wording is why #1466 refused to read it. The
// transcripts say otherwise: across all 50 conversations on the machine this was written on, every
// one carries the block, always in step 0, and none carries a second — agy states the selection at
// the start of a conversation as a change "from None", whether or not the user touched the setting.
//
// So this is a fact about THIS conversation, unlike `settings.json` (global, current, and not what
// an older conversation ran under). The bound: it is read from the head, so if agy ever starts
// writing a second block mid-conversation, the badge keeps naming the model the conversation
// STARTED on until it is next resumed. Wrong in a way the user caused and can see, and cheap —
// a bounded head read, on a file an agent appends to without limit.
const SETTINGS_BLOCK_RE = /<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/g;
// `.` ends the sentence, but a model name contains one too ("Gemini 3.6"), so the terminator is a
// period FOLLOWED BY a space or the end of the block — not the first period.
const MODEL_SELECTION_RE = /`Model Selection` from [\s\S]*? to (.+?)\.(?=\s|$)/;
// A name, not a paragraph. Anything longer means the wording moved and the capture ran on, and a
// header badge is the wrong place to find that out — the fallback label is.
const MODEL_NAME_MAX = 48;

/** The model named in a transcript head, or null if it names none. */
export function antigravityModelFromTranscriptHead(head: string): string | null {
  let model: string | null = null;
  for (const record of head.split("\n").map(parseJsonRecord)) {
    if (!record || !isUserInput(record) || typeof record.content !== "string") continue;
    // The LAST block wins: none of the captured transcripts has two, but if one ever does, the
    // later line is the later change.
    for (const [, block] of record.content.matchAll(SETTINGS_BLOCK_RE)) {
      const name = MODEL_SELECTION_RE.exec(block ?? "")?.[1]?.trim();
      if (name && name.length <= MODEL_NAME_MAX) model = name;
    }
  }
  return model;
}

async function readTranscriptSummary(file: string): Promise<{ title: string; mtime: number } | null> {
  const read = await readTranscriptHead(file, HEAD_BYTES);
  return read && { title: antigravityTitleFromTranscriptHead(read.head), mtime: read.mtime };
}

// The newest record per conversation. The log only grows, so one conversation can appear under
// several session keys (a session resumed under a new key) and the same key can appear twice.
function newestPerConversation(records: Iterable<AgentConversation>, cwd: string): AgentConversation[] {
  const byConversation = new Map<string, AgentConversation>();
  for (const record of records) {
    if (record.cwd !== cwd) continue;
    const known = byConversation.get(record.conversationId);
    if (!known || known.startedAt <= record.startedAt) byConversation.set(record.conversationId, record);
  }
  return [...byConversation.values()];
}

/**
 * Antigravity conversations started in `cwd`, newest first.
 *
 * A conversation whose transcript cannot be read is kept, not dropped, as long as its directory is
 * still there: agy creates the directory and the transcript together on the first user input, so an
 * unreadable transcript means the format moved — and a listing that silently returns nothing is worse
 * than one showing a resumable row under a default name.
 *
 * `startedAt` picks the candidates and the transcript's mtime then orders them, so a conversation
 * started long ago but resumed yesterday can fall outside the window once a single directory holds
 * more than `SCAN_LIMIT` of them. That is the trade codex makes too (it bounds by the timestamp in
 * the rollout filename): nothing here can order by recency without reading, and the log grows
 * forever, so an unbounded listing would do unbounded filesystem work on every session-list refresh.
 */
export async function listAntigravitySessions(
  root: string,
  records: Iterable<AgentConversation>,
  cwd: string,
  limit: number,
): Promise<AntigravitySessionSummary[]> {
  const live = newestPerConversation(records, cwd)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, SCAN_LIMIT)
    .filter((r) => antigravityConversationExists(root, r.conversationId));
  const summaries = await Promise.all(
    live.map(async (record) => {
      const summary = await readTranscriptSummary(antigravityTranscriptPath(root, record.conversationId));
      return { id: record.conversationId, title: summary?.title ?? DEFAULT_TITLE, mtime: summary?.mtime ?? record.startedAt };
    }),
  );
  // toSorted, not sort: sort mutates and returns the SAME array, so reading the return value
  // reads like a copy when it is not (sonarjs/no-misleading-array-reverse).
  return summaries.toSorted((a, b) => b.mtime - a.mtime).slice(0, limit);
}
