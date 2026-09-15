// @vitest-environment node
//
// The one correction the launch form is allowed to make (#2082), and the two ways it must refuse.
//
// The form's agent is decided synchronously — localStorage, or the literal "claude" — and
// availability arrives over HTTP afterwards. So this does not pick the initial value; it replaces
// one that turns out to be unlaunchable, and only then.
import { describe, it, expect } from "vitest";
import { agentCorrection } from "../../../src/composables/useAgentAvailability";
import type { AgentAvailability } from "../../../common/agentAvailability";

const CODEX_ONLY: AgentAvailability[] = [
  { agent: "claude", installed: false },
  { agent: "codex", installed: true },
];

describe("agentCorrection", () => {
  it("moves an untouched claude off a machine that has no claude", () => {
    expect(agentCorrection("claude", "claude", CODEX_ONLY)).toBe("codex");
  });

  // The user opened the picker and chose something while the answer was still in the air. Whatever
  // they chose, it is theirs — including an agent they are in the middle of installing, which is a
  // real thing to want and exactly when this race happens.
  it("refuses to move a value the user has already changed", () => {
    expect(agentCorrection("cursor", "claude", CODEX_ONLY)).toBeNull();
  });

  it("refuses to move an agent that is installed", () => {
    expect(agentCorrection("claude", "claude", [{ agent: "claude", installed: true }])).toBeNull();
  });

  // Silence is not absence. A host too old to serve the route, or a fetch that failed, answers
  // nothing — and nothing must change, which is what every release before this one did.
  it("refuses to move anything when availability is unknown", () => {
    expect(agentCorrection("claude", "claude", [])).toBeNull();
  });

  // A machine with no agent at all: the launcher refuses to start, and if this is somehow reached
  // there is nothing better to offer, so the value stays rather than being rewritten to another
  // agent that is equally absent.
  it("refuses to move when nothing at all is installed", () => {
    expect(agentCorrection("claude", "claude", [{ agent: "claude", installed: false }])).toBeNull();
  });

  // `pickedAgent` may hold a shell or a custom agent id, which are not TerminalAgents at all. Those
  // are by definition not the untouched value, so they are left alone without any type gymnastics.
  it("leaves a value that is not an agent alone", () => {
    expect(agentCorrection("shell", "claude", CODEX_ONLY)).toBeNull();
    expect(agentCorrection("custom:ollama", "claude", CODEX_ONLY)).toBeNull();
  });
});
