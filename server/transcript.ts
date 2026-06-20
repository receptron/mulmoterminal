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

// The most recent user-typed prompt in a transcript: the last "user" line with real
// text, falling back to a "last-prompt" record if there are no user lines. Used to
// show a freshly-resumed session's latest prompt when no live in-memory prompt exists.
export function latestUserPromptFromJsonl(raw: string): string | null {
  let lastUser: string | null = null;
  let lastPromptRecord: string | null = null;
  for (const o of parseJsonl(raw)) {
    if (o.type === "user") {
      const prompt = userPromptText(isRecord(o.message) ? o.message.content : undefined);
      if (prompt) lastUser = prompt;
    } else if (o.type === "last-prompt" && o.lastPrompt) {
      lastPromptRecord = String(o.lastPrompt);
    }
  }
  return lastUser ?? lastPromptRecord;
}
