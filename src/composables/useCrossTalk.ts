// One exchange between two terminals: hand this cell's last turn to another cell, wait
// for it to answer, and bring the answer back — both legs submitted rather than left in
// the input box (#595).
//
// This is the first thing here that types into a terminal WITHOUT a human pressing Enter,
// so the ordering is deliberate. Nothing is ever sent to a terminal mid-turn: each leg
// waits for a turn that did not exist before to appear in the agent's own log. A terminal
// blocked on an approval prompt never completes a turn, so it is waited for and then
// times out rather than being typed into.
import { pasteAndSubmit, listSlots } from "./useTerminalConnections";
import { waitVerdict, type ExchangeOutcome, type TurnSnapshot } from "./exchangeRules";
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
  /** Is that slot STILL running the session we started with? Submitting addresses a slot,
   *  not a conversation, so a cell whose session was switched mid-exchange would receive
   *  the answer into whatever it runs now. Checked immediately before every submit. */
  runsSession: (key: string, sessionId: string) => boolean;
}

// Poll the terminal's log until the turn OUR message produced shows up. Correlating on
// the text we sent — rather than on "something changed" — is what keeps a partner that was
// already mid-turn from handing us the wrong reply.
async function awaitAnswer(source: HandoffSource, sent: string, shape: "exchange" | "reply", deps: CrossTalkDeps): Promise<TurnFetch | ExchangeOutcome> {
  const startedAt = deps.now();
  for (;;) {
    await deps.sleep(POLL_MS);
    if (deps.isAborted()) return "stopped";
    const now = await deps.fetchTurn(source, shape);
    const verdict = waitVerdict(now, sent, deps.now() - startedAt, ANSWER_TIMEOUT_MS);
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
    if (deps.isAborted()) return { outcome: "stopped" };
    if (!deps.runsSession(partner.key, partner.source.sessionId)) return { outcome: "session-changed" };
    if (!deps.submit(partner.key, mine.text)) return { outcome: "failed" };

    const answer = await awaitAnswer(partner.source, mine.text, "reply", deps);
    if (typeof answer === "string") return { outcome: answer };
    if (!answer.text) return { outcome: "nothing-to-send" };
    if (deps.isAborted()) return { outcome: "stopped" };
    if (!deps.runsSession(self.key, self.source.sessionId)) return { outcome: "session-changed" };
    if (!deps.submit(self.key, answer.text)) return { outcome: "failed" };

    const back = await awaitAnswer(self.source, answer.text, "exchange", deps);
    return { outcome: typeof back === "string" ? back : "answered" };
  } catch {
    return { outcome: "failed" };
  }
}

// The real wiring: the server for the excerpt, the socket for the submit, and a stop
// signal the caller owns. Split from runOneExchange so the ordering above can be driven
// with fakes — no sockets, no clock, no server.
export function liveCrossTalkDeps(isAborted: () => boolean): CrossTalkDeps {
  return {
    fetchTurn: (source, shape) => fetchLastTurn(source, shape),
    submit: pasteAndSubmit,
    runsSession: (key, sessionId) => listSlots().some((slot) => slot.key === key && slot.sessionId === sessionId),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
    isAborted,
  };
}
