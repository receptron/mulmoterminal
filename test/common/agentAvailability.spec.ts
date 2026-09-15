// @vitest-environment node
//
// Which agent the launch form should OFFER (#2082), which is a different question from which agent
// an absent field MEANS. The second is `claude` forever — it is what a grid cell persisted before
// the field existed says — and nothing here may move it.
import { describe, it, expect } from "vitest";
import { knownMissing, offerableAgent, parseAgentAvailability, type AgentAvailability } from "../../common/agentAvailability";
import { TERMINAL_AGENTS } from "../../common/sessionAgent";

const availability = (installed: string[]): AgentAvailability[] => TERMINAL_AGENTS.map((agent) => ({ agent, installed: installed.includes(agent) }));

describe("parseAgentAvailability", () => {
  it("reads the route's body", () => {
    expect(parseAgentAvailability({ agents: [{ agent: "codex", installed: true }] })).toEqual([{ agent: "codex", installed: true }]);
  });

  // A host too old to serve the route says NOTHING about what is installed, and "nothing known"
  // has to leave the current default alone rather than move it. Every one of these is that case.
  it.each([null, undefined, 42, "agents", {}, { agents: null }, { agents: "codex" }])("answers an empty list for %p rather than throwing", (body) => {
    expect(parseAgentAvailability(body)).toEqual([]);
  });

  it("drops an entry that is not an agent, keeping the ones that are", () => {
    const body = { agents: [{ agent: "codex", installed: true }, { agent: "emacs", installed: true }, { agent: "claude" }, null, "claude"] };
    expect(parseAgentAvailability(body)).toEqual([{ agent: "codex", installed: true }]);
  });
});

describe("knownMissing", () => {
  it("is true only when the list says the agent is not installed", () => {
    expect(knownMissing("claude", availability(["codex"]))).toBe(true);
    expect(knownMissing("codex", availability(["codex"]))).toBe(false);
  });

  // The distinction the whole feature rests on: silence is not absence. An agent nothing was said
  // about must not be walked away from, or a failed fetch would move the user's default on no
  // evidence at all.
  it("is false for an agent the list says nothing about", () => {
    expect(knownMissing("claude", [])).toBe(false);
    expect(knownMissing("claude", [{ agent: "codex", installed: true }])).toBe(false);
  });
});

describe("offerableAgent", () => {
  it("keeps claude on a machine that has it", () => {
    expect(offerableAgent("claude", availability(["claude", "codex"]))).toBe("claude");
  });

  it("offers the installed agent when claude is missing", () => {
    expect(offerableAgent("claude", availability(["codex"]))).toBe("codex");
  });

  // Stable rather than arbitrary: two machines with the same CLIs must agree, and one machine must
  // answer the same on every boot. TERMINAL_AGENTS order is what provides that.
  it("picks the first installed agent in a fixed order, not whichever the list happened to name", () => {
    const reversed = [...availability(["cursor", "codex"])].reverse();
    expect(offerableAgent("claude", reversed)).toBe("codex");
  });

  // Not the same as "keeps claude": the point is that a DELIBERATE pick is never overridden, and the
  // caller enforces that too by only asking about an untouched value.
  it("keeps an agent that is installed, whichever it is", () => {
    expect(offerableAgent("cursor", availability(["claude", "cursor"]))).toBe("cursor");
  });

  it("keeps the current agent when nothing is known", () => {
    expect(offerableAgent("claude", [])).toBe("claude");
  });

  // A machine with no agent at all cannot be helped by moving the pick — the launcher refuses to
  // start in that case, and if one is somehow reached it must not be silently rewritten to another
  // agent that is equally absent.
  it("keeps the current agent when nothing is installed", () => {
    expect(offerableAgent("claude", availability([]))).toBe("claude");
  });
});
