// The decisions a cross-terminal exchange makes, kept away from the sockets and timers
// that carry it out. An exchange hands one terminal's turn to another, waits for that
// terminal to answer, and brings the answer back — so the rule that matters is "is this
// turn the answer to what WE sent?".

export interface TurnSnapshot {
  prompt: string | null;
  reply: string | null;
}

// Enough of the sent text to identify it. Taken from the END because that is where the
// quoted excerpt sits: the opening lines are the same framing on every handoff, so a
// prefix would match the previous round's message just as well.
const CORRELATION_TAIL = 160;

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

// Is this turn the one OUR message produced? The text we submit becomes that terminal's
// next prompt, so the prompt is the causal link — and the only thing that distinguishes
// the answer we are waiting for from a turn that was already in flight when we sent.
//
// Waiting on "any new turn" instead relays whatever the terminal happened to finish
// first, which for a busy partner is not our answer at all.
export function answersOurSend(prompt: string | null, sent: string): boolean {
  if (!prompt || !sent.trim()) return false;
  const needle = collapse(sent).slice(-CORRELATION_TAIL);
  return needle.length > 0 && collapse(prompt).includes(needle);
}

export type WaitVerdict = "answered" | "keep-waiting" | "timed-out";

// Whether to keep polling. The deadline is wall-clock rather than a poll count so a slow
// machine doesn't give up sooner than a fast one. A late answer still counts as answered:
// the terminal did reply, and relaying it beats discarding it.
export function waitVerdict(now: TurnSnapshot, sent: string, elapsedMs: number, timeoutMs: number): WaitVerdict {
  if (answersOurSend(now.prompt, sent)) return "answered";
  return elapsedMs >= timeoutMs ? "timed-out" : "keep-waiting";
}

// An exchange stops for one of these; the first four are ordinary, `failed` is not.
export type ExchangeOutcome = "answered" | "stopped" | "timed-out" | "nothing-to-send" | "session-changed" | "failed";

const OUTCOME_MESSAGE: Record<Exclude<ExchangeOutcome, "answered">, string> = {
  stopped: "Stopped",
  "session-changed": "A terminal switched session — stopped",
  "timed-out": "The other terminal did not answer in time",
  "nothing-to-send": "No completed turn to send yet",
  failed: "Could not reach the other terminal",
};

// What the cell shows afterwards. A completed exchange says nothing — the answer arriving
// in the terminal is the feedback.
export const outcomeMessage = (outcome: ExchangeOutcome): string | null => (outcome === "answered" ? null : OUTCOME_MESSAGE[outcome]);
