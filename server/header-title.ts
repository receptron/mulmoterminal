// AI header title (issue #316). A terminal cell's header shows the last user prompt,
// which goes stale or meaningless once the session turns into a back-and-forth ("はい",
// "2番目にして"). Instead we summarize the recent turns with a cheap model into a short
// title. Pure helpers (decision / prompt / parse / render) are unit-testable without the
// `claude` CLI; generateHeaderTitle wires them to the shared headless-spawn helper.
import { runClaudeHeadless, type RunClaude } from "./command-summary.js";
import { claudeAdapter } from "./agents/claude.js";
import { conversationTurnsFromJsonl, type ConversationTurn } from "./transcript.js";

// A title needs no frontier quality and runs on many turns, so default to a small/fast
// model. Overridable per deploy (e.g. a full model id) via MT_TITLE_MODEL.
export const DEFAULT_TITLE_MODEL = "haiku";
export const titleModel = (): string => process.env.MT_TITLE_MODEL || DEFAULT_TITLE_MODEL;

// Regenerate at most every N user turns so a long session's title stays current without
// a model call on every single turn.
export const TITLE_REGEN_EVERY_TURNS = 5;
// The grid roster re-titles on view (for sessions the hook path never runs on — unmanaged,
// resumed, or post-restart). Tighter than the hook cadence since it only fires while the
// roster is actually being watched.
export const VIEW_TITLE_REGEN_TURNS = 3;
const TITLE_TIMEOUT_MS = 30_000;
// The USER's turns define what the session is about; a long agentic stretch can leave the
// last N turns entirely assistant (no user intent), so the window is anchored on the last
// few USER turns plus the latest assistant turn for context. Assistant text is clipped
// much shorter so its verbosity doesn't drown the user's intent.
const USER_TURNS_IN_WINDOW = 5;
const USER_TURN_CHARS = 600;
const ASSISTANT_TURN_CHARS = 160;
export const MAX_TITLE_CHARS = 80;

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…` : s);

// Regenerate the title when there's none yet, when the newest prompt was a
// trivial/context-dependent ack (the raw last-prompt would be stale or meaningless), or
// every `maxTurns` turns to keep a long session's title fresh.
export function shouldRegenerateTitle(p: { hasTitle: boolean; promptIsTrivial: boolean; turnsSinceTitle: number; maxTurns: number }): boolean {
  return !p.hasTitle || p.promptIsTrivial || p.turnsSinceTitle >= p.maxTurns;
}

// Decide whether the roster should (re)summarize a viewed session on our side. Regenerate
// when the session has no title at all (a stale externally-written title we ignore, or a
// post-restart blank), or once the transcript has advanced `regenEveryTurns` user turns past
// the last titling. `lastTitledUserTurns` is null until we first title it. `hasTitle` guards
// the null-baseline path: a /clear blanks the title to "" (still `hasTitle`) while keeping the
// baseline null, so this must NOT re-title it from the still-frozen pre-clear transcript. A
// transcript with no user turn is skipped.
export function shouldFreshenViewedTitle(p: {
  hasTitle: boolean;
  lastTitledUserTurns: number | null;
  currentUserTurns: number;
  regenEveryTurns: number;
}): boolean {
  if (p.currentUserTurns === 0) return false;
  if (p.lastTitledUserTurns === null) return !p.hasTitle;
  return p.currentUserTurns - p.lastTitledUserTurns >= p.regenEveryTurns;
}

// The summarizer window: the last few USER turns (they define the task) plus the most
// recent assistant turn for context. Anchoring on user turns keeps intent in view even
// after a long assistant-only tool stretch. Empty when there is no user turn to title.
export function titleWindow(turns: ConversationTurn[]): ConversationTurn[] {
  const users = turns.filter((t) => t.role === "user").slice(-USER_TURNS_IN_WINDOW);
  if (users.length === 0) return [];
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");
  return lastAssistant ? [...users, lastAssistant] : users;
}

// A labelled transcript the model reads on stdin, assistant turns clipped shorter.
export function renderTurns(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${clip(t.text, t.role === "user" ? USER_TURN_CHARS : ASSISTANT_TURN_CHARS)}`)
    .join("\n");
}

export function buildTitlePrompt(): string {
  return [
    "Below (on stdin) is the recent transcript of a coding session between a User and an AI Assistant.",
    "Summarize what the USER is trying to accomplish as a short, concise title: a phrase, NOT a full",
    "sentence — no trailing punctuation. Base it on the User's intent, not the Assistant's wording.",
    "Match the User's language.",
    "Output ONLY the title: no quotes, no labels, no explanation.",
  ].join("\n");
}

const EDGE_QUOTES = new Set(['"', "'", "「", "『", "」", "』"]);

// Strip any wrapping quote characters via an explicit edge scan (linear, no regex
// backtracking) — the model sometimes wraps the title in quotes despite the prompt.
function stripQuotes(text: string): string {
  const chars = [...text];
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE_QUOTES.has(chars[start])) start++;
  while (end > start && EDGE_QUOTES.has(chars[end - 1])) end--;
  return chars.slice(start, end).join("").trim();
}

// Take the first non-empty line, strip surrounding quotes, and cap the length.
export function parseTitleOutput(stdout: string): string {
  const firstLine =
    stdout
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return clip(stripQuotes(firstLine), MAX_TITLE_CHARS);
}

export interface GenerateTitleDeps {
  runClaude?: RunClaude;
  claudeBin?: string;
  model?: string;
}

// Summarize the transcript's recent turns into a short title, or null if there's nothing
// to title yet. Never throws — a failed/timed-out CLI yields null so the header falls
// back to the last prompt.
export async function generateHeaderTitle(rawTranscript: string, deps: GenerateTitleDeps = {}): Promise<string | null> {
  const turns = titleWindow(conversationTurnsFromJsonl(rawTranscript));
  if (turns.length === 0) return null;
  const runClaude = deps.runClaude ?? runClaudeHeadless;
  try {
    const { stdout } = await runClaude({
      bin: deps.claudeBin ?? claudeAdapter.bin(),
      prompt: buildTitlePrompt(),
      input: renderTurns(turns),
      timeoutMs: TITLE_TIMEOUT_MS,
      model: deps.model ?? titleModel(),
    });
    return parseTitleOutput(stdout) || null;
  } catch {
    return null;
  }
}
