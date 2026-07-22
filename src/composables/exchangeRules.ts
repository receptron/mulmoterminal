// The decisions a cross-terminal exchange makes, kept away from the sockets and timers
// that carry it out. An exchange hands one terminal's turn to another, waits for that
// terminal to answer, and brings the answer back — so the rules that matter are "has it
// answered yet?" and "how long do we keep asking?".

export interface TurnSnapshot {
  prompt: string | null;
  reply: string | null;
}

// Has the terminal produced a NEW turn since the snapshot? Comparing the whole exchange —
// not just the reply — is what makes this reliable: the text we submitted becomes that
// terminal's next prompt, so the pair always changes once it has read us, even if the
// wording of its answer happens to repeat.
//
// This is also the double-send guard. Nothing is relayed onward until a turn that did not
// exist before is on disk, so a slow agent is waited for rather than sent to twice.
export function turnAdvanced(before: TurnSnapshot | null, now: TurnSnapshot): boolean {
  if (!now.prompt && !now.reply) return false; // nothing recorded yet
  return now.prompt !== (before?.prompt ?? null) || now.reply !== (before?.reply ?? null);
}

export type WaitVerdict = "answered" | "keep-waiting" | "timed-out";

// Whether to keep polling. The deadline is wall-clock rather than a poll count so a
// slow machine doesn't give up sooner than a fast one.
export function waitVerdict(before: TurnSnapshot | null, now: TurnSnapshot, elapsedMs: number, timeoutMs: number): WaitVerdict {
  if (turnAdvanced(before, now)) return "answered";
  return elapsedMs >= timeoutMs ? "timed-out" : "keep-waiting";
}

// An exchange stops for one of these; the first four are ordinary, `failed` is not.
export type ExchangeOutcome = "answered" | "stopped" | "timed-out" | "nothing-to-send" | "failed";

const OUTCOME_MESSAGE: Record<Exclude<ExchangeOutcome, "answered">, string> = {
  stopped: "Stopped",
  "timed-out": "The other terminal did not answer in time",
  "nothing-to-send": "No completed turn to send yet",
  failed: "Could not reach the other terminal",
};

// What the cell shows afterwards. A completed exchange says nothing — the answer arriving
// in the terminal is the feedback.
export const outcomeMessage = (outcome: ExchangeOutcome): string | null => (outcome === "answered" ? null : OUTCOME_MESSAGE[outcome]);
