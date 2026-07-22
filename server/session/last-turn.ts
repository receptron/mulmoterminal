// The last COMPLETED exchange of a session — one user prompt plus the agent's final
// reply — read from the agent's own log rather than the terminal's screen buffer, and
// normalized so a Claude turn and a codex turn are the same shape. A turn still in
// flight is skipped: codex writes its rollout lazily, so "what it is saying right now"
// simply isn't on disk (#254).

import { conversationTurnsFromParsed, parseJsonl, isRecord } from "./transcript.js";

export interface LastTurn {
  prompt: string | null;
  reply: string | null;
}

export const EMPTY_TURN: LastTurn = { prompt: null, reply: null };

// Claude's transcript interleaves narration and tool calls as separate assistant
// records; the LAST prose record of a turn is its conclusion, which is what a reader
// in another session wants. A turn only counts once it has that reply, so a prompt
// still being worked on falls back to the previous exchange.
export function lastTurnFromClaudeParsed(records: Record<string, unknown>[]): LastTurn {
  let open: LastTurn | null = null;
  let lastComplete: LastTurn | null = null;
  for (const turn of conversationTurnsFromParsed(records)) {
    if (turn.role === "user") {
      open = { prompt: turn.text, reply: null };
      continue;
    }
    open = { prompt: open?.prompt ?? null, reply: turn.text };
    lastComplete = open;
  }
  return lastComplete ?? EMPTY_TURN;
}

export const lastTurnFromClaudeJsonl = (raw: string): LastTurn => lastTurnFromClaudeParsed(parseJsonl(raw));

// codex tags only its turn BOUNDARIES with a turn_id (task_started / turn_context /
// task_complete) — the user_message and agent_message rows in between carry none. So a
// turn is the positional span between a task_started and its matching task_complete,
// and the id serves to pair those two rather than to group the contents.
const eventPayload = (doc: Record<string, unknown>, type: string): Record<string, unknown> | null => {
  const payload = isRecord(doc.payload) ? doc.payload : null;
  return doc.type === "event_msg" && payload?.type === type ? payload : null;
};

const trimmedString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

// Walk back to the task_started that opened this turn, then forward to the first
// prompt inside it. An unpaired task_complete (a rollout whose head was rotated away)
// leaves no start, and the turn is reported prompt-less rather than borrowing an
// earlier turn's prompt.
function codexPromptForTurn(docs: Record<string, unknown>[], completeIndex: number, turnId: string | null): string | null {
  let start = -1;
  for (let i = completeIndex - 1; i >= 0; i--) {
    const started = eventPayload(docs[i], "task_started");
    if (started && (turnId === null || started.turn_id === turnId)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let i = start + 1; i < completeIndex; i++) {
    const message = eventPayload(docs[i], "user_message");
    if (message) {
      const text = trimmedString(message.message);
      if (text) return text;
    }
  }
  return null;
}

// task_complete carries the turn's final answer whole (`last_agent_message`), so the
// agent_message rows never need reassembling. A turn that completed without one (an
// interrupt, an approval bounce) is skipped for the exchange before it.
export function lastTurnFromCodexRollout(raw: string): LastTurn {
  const docs = parseJsonl(raw);
  for (let i = docs.length - 1; i >= 0; i--) {
    const complete = eventPayload(docs[i], "task_complete");
    if (!complete) continue;
    const reply = trimmedString(complete.last_agent_message);
    if (!reply) continue;
    return { prompt: codexPromptForTurn(docs, i, trimmedString(complete.turn_id)), reply };
  }
  return EMPTY_TURN;
}
