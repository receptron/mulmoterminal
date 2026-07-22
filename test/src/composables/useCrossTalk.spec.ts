import { describe, it, expect } from "vitest";
import { runOneExchange, type CrossTalkDeps, type TurnFetch } from "../../../src/composables/useCrossTalk";
import type { HandoffSource, HandoffTarget } from "../../../src/composables/useHandoff";

const src = (id: string): HandoffSource => ({ sessionId: id, cwd: "/w", agent: "claude" });
const self = { key: "cell-1", source: src("A") };
const partner: HandoffTarget = { key: "cell-2", label: "#2", source: src("B") };

// A pair of fake terminals. Each `answer()` gives one of them a new turn, which is what
// the exchange polls for. `sleep` resolves immediately and advances a fake clock.
function harness(options: { autoAnswer?: boolean } = {}) {
  const turns: Record<string, TurnFetch> = {
    A: { prompt: "my question", reply: "my work so far", text: "TEXT-A" },
    B: { prompt: null, reply: null, text: "" },
  };
  const submitted: Array<[string, string]> = [];
  let clock = 0;
  let aborted = false;
  let round = 0;

  const deps: CrossTalkDeps = {
    fetchTurn: async (source) => ({ ...turns[source.sessionId] }),
    submit: (key, text) => {
      submitted.push([key, text]);
      if (options.autoAnswer) {
        // A real agent records what it was sent as its prompt; that is what the exchange
        // correlates on, so the fake has to do the same.
        const id = key === partner.key ? "B" : "A";
        round += 1;
        turns[id] = { prompt: text, reply: `reply-${round}`, text: `TEXT-${id}-${round}` };
      }
      return true;
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    isAborted: () => aborted,
    runsSession: () => sessionsIntact,
  };
  let sessionsIntact = true;
  return { deps, submitted, turns, abort: () => (aborted = true), switchSession: () => (sessionsIntact = false) };
}

describe("runOneExchange", () => {
  it("sends this cell's turn out and brings the answer back", async () => {
    const h = harness({ autoAnswer: true });
    const { outcome } = await runOneExchange(self, partner, h.deps);
    expect(outcome).toBe("answered");
    expect(h.submitted.map(([key]) => key)).toEqual(["cell-2", "cell-1"]);
    expect(h.submitted[0][1]).toBe("TEXT-A"); // our turn went to the partner...
    expect(h.submitted[1][1]).toBe("TEXT-B-1"); // ...and their answer came back to us
  });

  it("sends nothing when this cell has no completed turn", async () => {
    const h = harness();
    h.turns.A = { prompt: null, reply: null, text: "" };
    const { outcome } = await runOneExchange(self, partner, h.deps);
    expect(outcome).toBe("nothing-to-send");
    expect(h.submitted).toEqual([]);
  });

  it("never sends twice while the partner is still working", async () => {
    // The partner never answers, so the exchange waits and gives up. One send, not a
    // stream of them — this is the guard against typing into a busy terminal.
    const h = harness();
    const { outcome } = await runOneExchange(self, partner, h.deps);
    expect(outcome).toBe("timed-out");
    expect(h.submitted).toHaveLength(1);
  });

  it("ignores a turn the partner was ALREADY running when we sent", async () => {
    // The regression this guards: waiting on "any new turn" would take that unrelated
    // completion for our answer and relay its content back.
    const h = harness();
    let polls = 0;
    const deps: CrossTalkDeps = {
      ...h.deps,
      submit: (key, text) => {
        h.submitted.push([key, text]);
        if (key === partner.key) {
          // A turn they were already running lands first; ours only after a poll or two.
          h.turns.B = { prompt: "something they were already doing", reply: "unrelated answer", text: "TEXT-UNRELATED" };
          answerAfter = { prompt: text, reply: "our answer", text: "TEXT-OURS" };
        } else {
          h.turns.A = { prompt: text, reply: "acknowledged", text: "TEXT-A-2" }; // our own cell answers the return leg
        }
        return true;
      },
      fetchTurn: async (source) => {
        if (source.sessionId === "B" && ++polls === 3 && answerAfter) h.turns.B = answerAfter;
        return { ...h.turns[source.sessionId] };
      },
    };
    let answerAfter: TurnFetch | null = null;
    const { outcome } = await runOneExchange(self, partner, deps);
    expect(outcome).toBe("answered");
    // The unrelated turn was on disk first and was NOT what came back to us.
    expect(h.submitted.map(([, text]) => text)).toEqual(["TEXT-A", "TEXT-OURS"]);
  });

  it("stops mid-wait when the user stops it, without sending the return leg", async () => {
    const h = harness();
    let polls = 0;
    const deps: CrossTalkDeps = {
      ...h.deps,
      fetchTurn: async (source) => {
        if (source.sessionId === "B" && ++polls === 2) h.abort();
        return { ...h.turns[source.sessionId] };
      },
    };
    const { outcome } = await runOneExchange(self, partner, deps);
    expect(outcome).toBe("stopped");
    expect(h.submitted).toHaveLength(1);
  });

  it("stops before sending anything when stopped up front", async () => {
    const h = harness();
    h.abort();
    const { outcome } = await runOneExchange(self, partner, h.deps);
    expect(outcome).toBe("stopped");
    expect(h.submitted).toEqual([]);
  });

  it("reports a terminal that could not be written to", async () => {
    const h = harness();
    const { outcome } = await runOneExchange(self, partner, { ...h.deps, submit: () => false });
    expect(outcome).toBe("failed");
  });

  it("reports a failed read rather than throwing", async () => {
    const h = harness();
    const { outcome } = await runOneExchange(self, partner, {
      ...h.deps,
      fetchTurn: async () => {
        throw new Error("network");
      },
    });
    expect(outcome).toBe("failed");
  });

  it("relays the partner's answer using the reply shape, not the full exchange", async () => {
    // Otherwise the answer comes back wrapped around a copy of our own words.
    const shapes: string[] = [];
    const h = harness({ autoAnswer: true });
    await runOneExchange(self, partner, {
      ...h.deps,
      fetchTurn: async (source, shape) => {
        if (source.sessionId === "B") shapes.push(shape);
        return { ...h.turns[source.sessionId] };
      },
    });
    expect(shapes.every((s) => s === "reply")).toBe(true);
  });

  it("refuses to submit into a cell that switched session mid-exchange", async () => {
    // Submitting addresses a slot, not a conversation. Without this the answer lands in
    // whatever conversation the user just switched that cell to.
    const h = harness({ autoAnswer: true });
    h.switchSession();
    const { outcome } = await runOneExchange(self, partner, h.deps);
    expect(outcome).toBe("session-changed");
    expect(h.submitted).toEqual([]);
  });
});
