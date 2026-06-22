// Pure helpers for reading Claude session transcripts (the per-project .jsonl
// files). Kept separate from index.ts so they're unit-testable without the server's
// startup side effects.

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// A real user prompt from a JSONL "user" line's content, or null if it's a
// slash-/local-command wrapper rather than a typed prompt. Content may be a plain
// string or an array of blocks (guard against null elements).
export function userPromptText(content: unknown): string | null {
  const text = Array.isArray(content) ? content.map((x) => (isRecord(x) ? String(x.text ?? "") : String(x ?? ""))).join(" ") : content;
  if (typeof text === "string" && text.trim() && !/^\s*<(local-command|command-|bash-)/.test(text)) {
    return text.trim();
  }
  return null;
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

// Ordered user-typed prompts in a transcript + the "last-prompt" fallback record.
function collectPrompts(raw: string): { prompts: string[]; lastPromptRecord: string | null } {
  const prompts: string[] = [];
  let lastPromptRecord: string | null = null;
  for (const o of parseJsonl(raw)) {
    if (o.type === "user") {
      const prompt = userPromptText(isRecord(o.message) ? o.message.content : undefined);
      if (prompt) prompts.push(prompt);
    } else if (o.type === "last-prompt" && o.lastPrompt) {
      lastPromptRecord = String(o.lastPrompt);
    }
  }
  return { prompts, lastPromptRecord };
}

// The most recent user-typed prompt in a transcript: the last "user" line with real
// text, falling back to a "last-prompt" record if there are no user lines.
export function latestUserPromptFromJsonl(raw: string): string | null {
  const { prompts, lastPromptRecord } = collectPrompts(raw);
  return prompts[prompts.length - 1] ?? lastPromptRecord;
}

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
  while (start < end && EDGE_PUNCT.has(chars[start])) start++;
  while (end > start && EDGE_PUNCT.has(chars[end - 1])) end--;
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
export function latestMeaningfulUserPromptFromJsonl(raw: string): string | null {
  const { prompts, lastPromptRecord } = collectPrompts(raw);
  for (let i = prompts.length - 1; i >= 0; i--) {
    if (!isTrivialPrompt(prompts[i])) return prompts[i];
  }
  return prompts[prompts.length - 1] ?? lastPromptRecord;
}
