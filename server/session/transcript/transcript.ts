// Pure helpers for reading Claude session transcripts (the per-project .jsonl
// files). Kept separate from index.ts so they're unit-testable without the server's
// startup side effects.

import { isRecord } from "../../../common/isRecord.js";
import { readString } from "../../../common/readString.js";
import type { SessionContextInfo } from "../../../common/sessionContext.js";
import { emptyTurnBoundary, opensTurn, type TurnBoundaryState } from "./turn-boundary.js";

// Text the HARNESS put in the user channel, rather than something a person typed:
// slash-command wrappers, bash input, and the notification a finished background task
// writes there — no more a typed prompt than a slash command is.
//
// Exported because TWO paths decide this and only one used to: the commit that added
// `task-notification` (e1e19c66) taught the transcript reader, while the live
// `UserPromptSubmit` hook went on taking the XML as the session's latest prompt and
// putting it on the cell header (#1384). Both call this now, so a marker cannot be
// added to one and forgotten on the other.
//
// The `^\s*` anchor is what keeps the list safe to widen: 591 user lines in the
// transcripts on this machine MENTION `<task-notification` mid-sentence — the /loop
// skill's own documentation among them — and matching those would delete the prompt
// instead of the injection.
const INJECTED_PROMPT_RE = /^\s*<(local-command|command-|bash-|task-notification|system-reminder)/;

export const isInjectedPrompt = (text: string): boolean => INJECTED_PROMPT_RE.test(text);

// A real user prompt from a JSONL "user" line's content, or null if it's injected.
// Content may be a plain string or an array of blocks (guard against null elements).
export function userPromptText(content: unknown): string | null {
  // `x: unknown` is load-bearing: Array.isArray narrows `unknown` to `any[]`, and an `any`
  // element puts every read below back outside the type checker's reach.
  const text = Array.isArray(content) ? content.map((x: unknown) => (isRecord(x) ? readString(x.text) : readString(x))).join(" ") : content;
  if (typeof text === "string" && text.trim() && !isInjectedPrompt(text)) {
    return text.trim();
  }
  return null;
}

/** The prompt a user record OPENS a turn with, or null: no prompt text, or text written into the
 *  turn already open (a skill's body, an image note). Advances `state`, so take it once per record
 *  and hand the answer to every rule that needs it. */
export function turnOpeningPrompt(state: TurnBoundaryState, o: Record<string, unknown>): string | null {
  if (o.type !== "user") return null;
  const text = userPromptText(isRecord(o.message) ? o.message.content : undefined);
  return text !== null && opensTurn(state, o) ? text : null;
}

// Parse a JSONL file into the objects on each non-blank, valid line.
export function parseJsonl(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const o: unknown = JSON.parse(line);
      if (isRecord(o)) out.push(o);
    } catch {
      // Skip malformed lines.
    }
  }
  return out;
}

// Every `*FromParsed` helper takes an already-parsed transcript so a caller that needs
// several of them (readSessionSummary) parses the .jsonl ONCE. The `*FromJsonl` wrappers
// (parse-then-derive) stay for one-off callers and existing tests.

// What the two "latest prompt" rules actually need to remember. Both are a choice between the same
// three things, and each is a LAST — which is why a streaming caller can keep three strings instead
// of every user record it has ever seen (#1377). The rule itself stays in one place: the array
// helpers below fold the same function over the same records.
export interface PromptTrail {
  /** The last prompt that was not a trivial ack. */
  meaningful: string | null;
  /** The last prompt of any kind, trivial or not. */
  latest: string | null;
  /** The `last-prompt` record a hook writes, for a transcript with no user lines at all. */
  record: string | null;
}

export const emptyPromptTrail = (): PromptTrail => ({ meaningful: null, latest: null, record: null });

/** `opening` is `turnOpeningPrompt`'s answer for this record. */
export function foldPromptTrail(into: PromptTrail, o: Record<string, unknown>, opening: string | null): void {
  if (opening !== null) {
    into.latest = opening;
    if (!isTrivialPrompt(opening)) into.meaningful = opening;
  } else if (o.type === "last-prompt" && o.lastPrompt) {
    into.record = readString(o.lastPrompt);
  }
}

const promptTrailOf = (records: Record<string, unknown>[]): PromptTrail => {
  const trail = emptyPromptTrail();
  const boundary = emptyTurnBoundary();
  for (const o of records) foldPromptTrail(trail, o, turnOpeningPrompt(boundary, o));
  return trail;
};

// The most recent user-typed prompt in a transcript: the last "user" line with real
// text, falling back to a "last-prompt" record if there are no user lines.
export function latestUserPromptFromParsed(records: Record<string, unknown>[]): string | null {
  const trail = promptTrailOf(records);
  return trail.latest ?? trail.record;
}
export const latestUserPromptFromJsonl = (raw: string): string | null => latestUserPromptFromParsed(parseJsonl(raw));

// The session title record, if the transcript carries one. Only READ here — this repo never
// writes "ai-title" lines into Claude's own file. **Claude Code writes it itself**, once per
// interactive session (measured: present in 92 of 93 sessions that have `mode` records, and
// never revised — 72 of 72 carried exactly one distinct title). That is what makes it usable
// as the header title without spawning anything (#1769).
export function aiTitleFromParsed(records: Record<string, unknown>[]): string | null {
  let title: string | null = null;
  for (const o of records) {
    if (o.type === "ai-title" && o.aiTitle) title = readString(o.aiTitle);
  }
  return title;
}
/** The name `/rename` gave, from one record: undefined when it is not a custom-title record, null
 *  when it renames to nothing (which clears the name). */
export function customTitleOfRecord(o: Record<string, unknown>): string | null | undefined {
  if (o.type !== "custom-title" || typeof o.customTitle !== "string") return undefined;
  return readString(o.customTitle).trim() || null;
}

export const aiTitleFromJsonl = (raw: string): string | null => aiTitleFromParsed(parseJsonl(raw));

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  /** Assistant only: does this record END the turn, or is the agent still working?
   *
   *  Claude writes a preamble ("I'll read the files first") as a complete assistant record BEFORE
   *  it runs any tool, so "there is prose" and "the turn is over" are different facts — and reading
   *  the first as the second relayed a preamble to another cell as its answer (#1487). Most callers
   *  here WANT the in-flight prose (the roster shows what an agent is saying right now); only
   *  `lastTurnFromClaudeParsed` needs the boundary, so it is carried rather than filtered. */
  endsTurn?: boolean;
}

/** `tool_use` is the only stop reason that means "I am not finished" — everything else
 *  (`end_turn`, `stop_sequence`, `max_tokens`, a refusal) ends the turn one way or another.
 *
 *  A record with NO stop reason counts as ending it. That is the pre-#1487 behaviour, and it is the
 *  safe direction to be wrong in: treating an unrecognised record as still-running would leave a
 *  turn that never completes, and every exchange waiting on it would time out. */
const endsTurn = (message: Record<string, unknown>): boolean => message.stop_reason !== "tool_use";

// The joined text of an assistant turn's content: only "text" blocks (tool_use blocks
// carry no prose a title would use). A plain-string content is returned as-is.
function assistantText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const parts = content.filter(isRecord).filter((b) => b.type === "text" && typeof b.text === "string");
  const joined = parts
    .map((b) => String(b.text).trim())
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

// One record as a turn, or null when it carries no prose (a tool-only assistant record, a
// slash-command wrapper) or is text written into the turn already open.
export function conversationTurnOf(boundary: TurnBoundaryState, o: Record<string, unknown>): ConversationTurn | null {
  const message = isRecord(o.message) ? o.message : null;
  const content = message?.content;
  if (o.type === "user") {
    const text = turnOpeningPrompt(boundary, o);
    return text ? { role: "user", text } : null;
  }
  if (o.type !== "assistant") return null;
  const text = assistantText(content);
  return text ? { role: "assistant", text, endsTurn: message ? endsTurn(message) : true } : null;
}

// Ordered user/assistant turns as plain text, skipping slash/local-command wrappers and
// tool-only assistant turns. Feeds the header-title summarizer.
export const conversationTurnsFromParsed = (records: Record<string, unknown>[]): ConversationTurn[] => {
  const turnOf = createConversationTurnScan();
  return records.flatMap((o) => turnOf(o) ?? []);
};

/** The same rule for a caller fed one record at a time: the boundary needs the records before. */
export function createConversationTurnScan(boundary: TurnBoundaryState = emptyTurnBoundary()): (o: Record<string, unknown>) => ConversationTurn | null {
  return (o) => conversationTurnOf(boundary, o);
}
export const conversationTurnsFromJsonl = (raw: string): ConversationTurn[] => conversationTurnsFromParsed(parseJsonl(raw));

// How many user turns the transcript holds, so the roster can tell whether a session has
// advanced far enough since its last summary to be worth re-titling.
export const countUserTurnsFromParsed = (records: Record<string, unknown>[]): number =>
  conversationTurnsFromParsed(records).filter((t) => t.role === "user").length;
export const countUserTurnsFromJsonl = (raw: string): number => countUserTurnsFromParsed(parseJsonl(raw));

// The most recent assistant prose turn (tool-only turns skipped), for the grid roster's
// "what did the agent just say" line. Null when the session has no assistant text yet.
export function latestAssistantTextFromParsed(records: Record<string, unknown>[]): string | null {
  const turns = conversationTurnsFromParsed(records);
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role === "assistant") return turn.text;
  }
  return null;
}
export const latestAssistantTextFromJsonl = (raw: string): string | null => latestAssistantTextFromParsed(parseJsonl(raw));

// A trivial prompt is an empty ack or a bare command ("ok", "merge", "はい") that
// doesn't describe what a session is about. The cell header skips these so a short
// follow-up doesn't hide the task. The explicit ack list is the primary signal —
// NOT prompt length, since terse but meaningful prompts exist ("UI", "DB", "修正",
// "対応"). Only a stray single character is treated as noise by length. Matched
// case-insensitively after trimming surrounding punctuation/whitespace.
const TRIVIAL_PROMPT_MIN_LEN = 2; // < 2 code points => a lone char, treated as noise
const TRIVIAL_PROMPT_WORDS = new Set([
  // English acks / one-word commands
  "ok",
  "okay",
  "k",
  "kk",
  "yes",
  "yep",
  "yeah",
  "ya",
  "no",
  "nope",
  "nah",
  "sure",
  "go",
  "run",
  "next",
  "done",
  "stop",
  "wait",
  "skip",
  "merge",
  "commit",
  "push",
  "pr",
  "continue",
  "proceed",
  "retry",
  "again",
  "good",
  "nice",
  "thanks",
  "thx",
  "lgtm",
  // Japanese acks / one-word commands
  "はい",
  "うん",
  "ええ",
  "いいえ",
  "よし",
  "了解",
  "りょ",
  "りょうかい",
  "おk",
  "おけ",
  "マージ",
  "コミット",
  "プッシュ",
  "続けて",
  "つづけて",
  "進めて",
  "すすめて",
  "やって",
  "お願い",
  "おねがい",
  "お願いします",
  "それで",
  "よろしく",
  "どうぞ",
]);

// Punctuation stripped from a prompt's edges before ack matching, so "ok." / "はい、"
// match the list.
const EDGE_PUNCT = new Set([".", "。", "!", "！", "?", "？", ",", "、"]);

// Trim surrounding whitespace, then surrounding punctuation. Done with an explicit
// edge scan (not a quantified regex) so it's clearly linear-time.
function normalizeForAck(text: string): string {
  const chars = [...text.trim().toLowerCase()];
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE_PUNCT.has(chars[start] ?? "")) start++;
  while (end > start && EDGE_PUNCT.has(chars[end - 1] ?? "")) end--;
  return chars.slice(start, end).join("").trim();
}

export function isTrivialPrompt(text: string): boolean {
  const norm = normalizeForAck(text);
  if (!norm) return true;
  if (TRIVIAL_PROMPT_WORDS.has(norm)) return true;
  return [...norm].length < TRIVIAL_PROMPT_MIN_LEN;
}

// The prompt the live cell header should show after a new one is submitted. Prefer
// the latest MEANINGFUL prompt: a trivial ack replaces nothing or another trivial
// prompt (so an all-trivial session still tracks the latest), but never overwrites a
// meaningful one. Mirrors latestMeaningfulUserPromptFromJsonl's fallback.
export function preferredHeaderPrompt(current: string | null, incoming: string): string {
  if (!isTrivialPrompt(incoming) || current === null || isTrivialPrompt(current)) return incoming;
  return current;
}

// Like latestUserPromptFromJsonl, but skips trivial acks and returns the most recent
// SUBSTANTIAL prompt, so a resumed session's header shows the task instead of a
// one-word follow-up. Falls back to the latest prompt (then the record) if every
// prompt is trivial.
export function latestMeaningfulUserPromptFromParsed(records: Record<string, unknown>[]): string | null {
  return meaningfulPromptOf(promptTrailOf(records));
}

/** The rule itself: the last substantial prompt, else the last prompt at all, else the record a
 *  hook left. One function, so a streaming caller and an array caller cannot answer differently. */
export const meaningfulPromptOf = (trail: PromptTrail): string | null => trail.meaningful ?? trail.latest ?? trail.record;
export const latestMeaningfulUserPromptFromJsonl = (raw: string): string | null => latestMeaningfulUserPromptFromParsed(parseJsonl(raw));

// Cumulative token usage for a session — summed across every assistant turn's
// `message.usage`. Each turn re-sends the growing context, so summing reflects the
// tokens actually consumed over the session (cache reads are counted separately, as
// they're discounted). Fresh input, output, and the two cache buckets are kept apart.
export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

const usageNum = (u: Record<string, unknown>, key: string): number => {
  const value = u[key];
  return typeof value === "number" ? value : 0;
};

export function sessionUsageFromParsed(records: Record<string, unknown>[]): SessionUsage {
  const total: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const o of records) {
    if (o.type !== "assistant" || !isRecord(o.message)) continue;
    const u = o.message.usage;
    if (!isRecord(u)) continue;
    total.inputTokens += usageNum(u, "input_tokens");
    total.outputTokens += usageNum(u, "output_tokens");
    total.cacheReadTokens += usageNum(u, "cache_read_input_tokens");
    total.cacheCreationTokens += usageNum(u, "cache_creation_input_tokens");
  }
  return total;
}
export const sessionUsageFromJsonl = (raw: string): SessionUsage => sessionUsageFromParsed(parseJsonl(raw));

// The CURRENT context size + running model for a session, from the LAST assistant
// turn. `contextTokens` is that turn's fresh input plus both cache buckets — the
// tokens re-sent as context for the next turn. This is NOT the cumulative
// sessionUsageFromJsonl sum, which counts every turn's re-sent context and so
// double-counts. `model` is the most recent assistant turn's declared model.
//
// The shape is shared with the UI (common/sessionContext.ts) because it goes on the wire
// whole; this name is what the Claude readers here have always called it. The Claude
// transcript reports no context window, so `contextWindow` stays absent on this path — the
// agents that DO report one fill it in (server/session/activity/agent-badges.ts).
export type LatestTurnContext = SessionContextInfo;

const contextTokensOf = (u: Record<string, unknown>): number =>
  usageNum(u, "input_tokens") + usageNum(u, "cache_read_input_tokens") + usageNum(u, "cache_creation_input_tokens");

export function latestTurnContextFromParsed(records: Record<string, unknown>[]): LatestTurnContext {
  // Both fields come from the SAME final assistant turn, so a new model is never
  // shown with a prior turn's context tokens. Usage absent on that turn → 0.
  let lastMessage: Record<string, unknown> | null = null;
  for (const o of records) {
    if (o.type === "assistant" && isRecord(o.message)) lastMessage = o.message;
  }
  if (!lastMessage) return { model: null, contextTokens: 0 };
  const model = typeof lastMessage.model === "string" && lastMessage.model ? lastMessage.model : null;
  const contextTokens = isRecord(lastMessage.usage) ? contextTokensOf(lastMessage.usage) : 0;
  return { model, contextTokens };
}
export const latestTurnContextFromJsonl = (raw: string): LatestTurnContext => latestTurnContextFromParsed(parseJsonl(raw));

// A single tool the agent ran, for the activity timeline. `summary` is a 1-line
// description drawn from the tool's most salient input (a command, a file path, …).
export interface TimelineEvent {
  ts: string; // ISO timestamp of the assistant turn that issued the tool_use
  tool: string; // tool name: Bash / Read / Edit / Write / Grep / …
  summary: string;
}

const SUMMARY_MAX_CHARS = 140;

const firstString = (...vals: unknown[]): string => {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
};

// The most salient input field per tool, collapsed to one line and capped. Falls
// back across the common input keys so an unknown tool still gets a useful summary.
function summarizeToolInput(input: unknown): string {
  const i = isRecord(input) ? input : {};
  const raw = firstString(i.command, i.file_path, i.path, i.pattern, i.url, i.query, i.prompt, i.description);
  const oneLine = raw.replace(/\s+/g, " ").trim();
  return oneLine.length > SUMMARY_MAX_CHARS ? `${oneLine.slice(0, SUMMARY_MAX_CHARS)}…` : oneLine;
}

// Chronological tool_use events from a transcript, for the activity timeline. Each
// assistant turn may carry several tool_use blocks; text blocks are ignored.
export function timelineFromJsonl(raw: string): TimelineEvent[] {
  return parseJsonl(raw).flatMap(timelineEventsIn);
}

/** The events one record contributes — so a caller streaming a transcript (#998) applies the same
 *  rule per record instead of restating it. */
export function timelineEventsIn(o: Record<string, unknown>): TimelineEvent[] {
  if (o.type !== "assistant" || !isRecord(o.message) || !Array.isArray(o.message.content)) return [];
  const ts = typeof o.timestamp === "string" ? o.timestamp : "";
  return o.message.content.flatMap((block) =>
    isRecord(block) && block.type === "tool_use" && typeof block.name === "string" ? [{ ts, tool: block.name, summary: summarizeToolInput(block.input) }] : [],
  );
}

// The tool names the agent ran in the CURRENT turn — since the last real user prompt —
// oldest→newest, for the work-phase classifier. Scoping to the turn (rather than a fixed
// last-N window over the whole transcript) is what keeps a prior turn's Edit from leaking
// into a new turn that's only reading, AND keeps the phase stable within a turn: an edit
// early in the turn still reads as "implementing" even after many later verification reads.
// A turn's opening prompt resets; tool results and text written mid-turn don't.
// Reuses readSessionSummary's single parse.
export function currentTurnToolNamesFromParsed(records: Record<string, unknown>[]): string[] {
  const scan = createCurrentTurnToolScan();
  records.forEach((o) => scan.add(o));
  return scan.names();
}

/** The same rule, fed one record at a time. It is already a fold — reset on a user prompt, append
 *  on a tool_use — so a streaming caller (#998) keeps the exact semantics rather than approximating
 *  them with a window. That matters: measured across the eight largest transcripts here, the
 *  longest single turn spans 3,615 records, so ANY fixed window would drop a turn's early edits and
 *  report `planning` for a turn that has already been implementing. */
export function foldTurnToolNames(names: string[], o: Record<string, unknown>, opening: string | null): void {
  if (opening !== null) {
    names.length = 0;
    return;
  }
  if (o.type !== "assistant" || !isRecord(o.message) || !Array.isArray(o.message.content)) return;
  for (const block of o.message.content) {
    if (isRecord(block) && block.type === "tool_use" && typeof block.name === "string") names.push(block.name);
  }
}

export function createCurrentTurnToolScan() {
  const names: string[] = [];
  const boundary = emptyTurnBoundary();
  return {
    add: (o: Record<string, unknown>) => foldTurnToolNames(names, o, turnOpeningPrompt(boundary, o)),
    names: (): string[] => names,
  };
}
