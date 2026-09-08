// The last COMPLETED exchange of a session — one user prompt plus the agent's final
// reply — read from the agent's own log rather than the terminal's screen buffer, and
// normalized so a Claude turn and a codex turn are the same shape. A turn still in
// flight is skipped: codex writes its rollout lazily, so "what it is saying right now"
// simply isn't on disk (#254).

import { conversationTurnsFromParsed, parseJsonl } from "./transcript.js";
import { codexEventPayload as eventPayload } from "../agents/codex-events.js";
import { codexUserPrompt } from "../agents/codex-user-turn.js";

export interface LastTurn {
  prompt: string | null;
  reply: string | null;
}

export const EMPTY_TURN: LastTurn = { prompt: null, reply: null };

// Claude's transcript interleaves narration and tool calls as separate assistant records; the
// prose record that ENDS the turn is its conclusion, which is what a reader in another session
// wants. A turn only counts once it has that reply, so a prompt still being worked on falls back
// to the previous exchange.
//
// "Ends the turn" is read from the record's own stop reason, not inferred from there being prose.
// Claude writes a preamble before it runs any tool, so the two are different facts, and taking the
// first for the second handed another cell "I'll read the actual files before weighing in." as a
// seat's whole contribution to a round table — the real answer, which disagreed with the others,
// arrived 40 seconds later and was never passed on (#1487). 78% of the assistant prose records in a
// sample of real transcripts were mid-turn, so this is the ordinary case, not an edge one.
export function lastTurnFromClaudeParsed(records: Record<string, unknown>[]): LastTurn {
  let open: LastTurn | null = null;
  let lastComplete: LastTurn | null = null;
  for (const turn of conversationTurnsFromParsed(records)) {
    if (turn.role === "user") {
      open = { prompt: turn.text, reply: null };
      continue;
    }
    if (!turn.endsTurn) continue; // still working — this is narration, not the answer
    open = { prompt: open?.prompt ?? null, reply: turn.text };
    lastComplete = open;
  }
  return lastComplete ?? EMPTY_TURN;
}

export const lastTurnFromClaudeJsonl = (raw: string): LastTurn => lastTurnFromClaudeParsed(parseJsonl(raw));

// The reply belonging to the NEWEST prompt, or null when that prompt has not been answered yet.
//
// The fallback above is what a handoff wants and what a push must never have: a turn that ended
// without prose — interrupted, or finished on a tool call — leaves the previous exchange as the
// newest complete one, and announcing it as this turn's outcome tells the user the wrong thing
// about the wrong turn (#1650). Over 11,489 real transcripts the fallback named an older turn at 193
// of 13,200 boundaries with the whole turn on disk, and at 1,629 of them for a read that landed one
// record early — an older reply every time rather than nothing, so there is no shape of that mistake
// the caller could have detected for itself.
export function currentTurnReplyFromClaudeParsed(records: Record<string, unknown>[]): string | null {
  let reply: string | null = null;
  for (const turn of conversationTurnsFromParsed(records)) {
    // A new prompt spends whatever answered the previous one: this turn has not replied yet.
    if (turn.role === "user") reply = null;
    else if (turn.endsTurn) reply = turn.text;
  }
  return reply;
}

// codex tags only its turn BOUNDARIES with a turn_id (task_started / turn_context /
// task_complete) — the prompt and reply rows in between carry none. So a turn is the
// positional span between a task_started and its matching task_complete, and the id
// serves to pair those two rather than to group the contents. The boundaries are reached
// through `eventPayload` above, which is shared with the badge reader; the prompt inside
// them is not, because codex has written it in two different record shapes and that
// question belongs to `codexUserPrompt` (#2011).
const trimmedString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

// Walk back to the task_started that opened this turn, then forward to the first
// prompt inside it. An unpaired task_complete (a rollout whose head was rotated away)
// leaves no start, and the turn is reported prompt-less rather than borrowing an
// earlier turn's prompt.
function codexPromptForTurn(docs: Record<string, unknown>[], completeIndex: number, turnId: string | null): string | null {
  let start = -1;
  for (let i = completeIndex - 1; i >= 0; i--) {
    const doc = docs[i];
    const started = doc === undefined ? null : eventPayload(doc, "task_started");
    if (started && (turnId === null || started.turn_id === turnId)) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  for (let i = start + 1; i < completeIndex; i++) {
    const doc = docs[i];
    const text = doc === undefined ? null : codexUserPrompt(doc);
    if (text) return text;
  }
  return null;
}

// task_complete carries the turn's final answer whole (`last_agent_message`), so the
// agent_message rows never need reassembling. A turn that completed without one (an
// interrupt, an approval bounce) is skipped for the exchange before it.
export function lastTurnFromCodexRollout(raw: string): LastTurn {
  return lastTurnFromCodexRolloutDocs(parseJsonl(raw));
}

/** The same, from records already parsed — so a caller that read only the file's tail (#998)
 *  doesn't have to rebuild a string just to hand it back. */
export function lastTurnFromCodexRolloutDocs(docs: Record<string, unknown>[]): LastTurn {
  for (let i = docs.length - 1; i >= 0; i--) {
    const doc = docs[i];
    const complete = doc === undefined ? null : eventPayload(doc, "task_complete");
    if (!complete) continue;
    const reply = trimmedString(complete.last_agent_message);
    if (!reply) continue;
    return { prompt: codexPromptForTurn(docs, i, trimmedString(complete.turn_id)), reply };
  }
  return EMPTY_TURN;
}
