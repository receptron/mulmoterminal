// One exchange between two terminals: hand this cell's last turn to another cell, wait
// for it to answer, and bring the answer back — both legs submitted rather than left in
// the input box (#595).
//
// This is the first thing here that types into a terminal WITHOUT a human pressing Enter,
// so the ordering is deliberate. Nothing is ever sent to a terminal mid-turn: each leg
// waits for a turn that did not exist before to appear in the agent's own log. A terminal
// blocked on an approval prompt never completes a turn, so it is waited for and then
// times out rather than being typed into.
import { pasteAndSubmit } from "./useTerminalConnections";
import { turnAdvanced, waitVerdict, type ExchangeOutcome, type TurnSnapshot } from "./exchangeRules";
import { fetchLastTurn, type HandoffSource, type HandoffTarget } from "./useHandoff";

export const ANSWER_TIMEOUT_MS = 10 * 60_000;
export const POLL_MS = 2_000;

export interface TurnFetch extends TurnSnapshot {
  text: string;
}

export interface CrossTalkDeps {
  /** `shape: "reply"` asks for the answer alone, without quoting the asker's own words back. */
  fetchTurn: (source: HandoffSource, shape: "exchange" | "reply") => Promise<TurnFetch>;
  submit: (key: string, text: string) => boolean;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** True once the user has stopped this exchange, or a cell involved has gone away. */
  isAborted: () => boolean;
}

// Poll the terminal's log until a turn appears that wasn't there when we sent.
async function awaitAnswer(source: HandoffSource, before: TurnSnapshot, deps: CrossTalkDeps): Promise<TurnFetch | ExchangeOutcome> {
  const startedAt = deps.now();
  for (;;) {
    await deps.sleep(POLL_MS);
    if (deps.isAborted()) return "stopped";
    const now = await deps.fetchTurn(source, "reply");
    const verdict = waitVerdict(before, now, deps.now() - startedAt, ANSWER_TIMEOUT_MS);
    if (verdict === "answered") return now;
    if (verdict === "timed-out") return "timed-out";
  }
}

export interface ExchangeResult {
  outcome: ExchangeOutcome;
}

// self → partner → self. `self` is the cell the user started this from; its own turn is
// what opens the exchange, and the partner's answer is submitted back into it.
export async function runOneExchange(self: { key: string; source: HandoffSource }, partner: HandoffTarget, deps: CrossTalkDeps): Promise<ExchangeResult> {
  try {
    const mine = await deps.fetchTurn(self.source, "exchange");
    if (!mine.text) return { outcome: "nothing-to-send" };
    const theirsBefore = await deps.fetchTurn(partner.source, "reply");
    if (deps.isAborted()) return { outcome: "stopped" };
    if (!deps.submit(partner.key, mine.text)) return { outcome: "failed" };

    const answer = await awaitAnswer(partner.source, theirsBefore, deps);
    if (typeof answer === "string") return { outcome: answer };
    if (!answer.text) return { outcome: "nothing-to-send" };
    // Snapshot our own turn only NOW: `mine` was read before the partner replied, and
    // between then and here the user may have run a turn of their own in this cell.
    const beforeReturn = await deps.fetchTurn(self.source, "exchange");
    if (deps.isAborted()) return { outcome: "stopped" };
    if (!deps.submit(self.key, answer.text)) return { outcome: "failed" };

    const back = await awaitAnswer(self.source, beforeReturn, deps);
    return { outcome: typeof back === "string" ? back : "answered" };
  } catch {
    return { outcome: "failed" };
  }
}

export { turnAdvanced };

// The real wiring: the server for the excerpt, the socket for the submit, and a stop
// signal the caller owns. Split from runOneExchange so the ordering above can be driven
// with fakes — no sockets, no clock, no server.
export function liveCrossTalkDeps(isAborted: () => boolean): CrossTalkDeps {
  return {
    fetchTurn: (source, shape) => fetchLastTurn(source, shape),
    submit: pasteAndSubmit,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
    isAborted,
  };
}
