// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { agentResumeId } from "../../../server/agents/agent-resume.js";

const KEY = "11111111-2222-4333-8444-555555555555";
const facts = (over: Partial<Parameters<typeof agentResumeId>[1]> = {}) => ({
  mappedId: null,
  conversationExists: () => false,
  hasLivePty: false,
  tmuxAlive: false,
  ...over,
});

describe("agentResumeId", () => {
  // The browser-facing key and codex's rollout id are different namespaces, and a key can
  // look like either. A rollout we recorded FOR this key is the authoritative answer.
  it("prefers the rollout id recorded for the key", () => {
    expect(agentResumeId(KEY, facts({ mappedId: "rollout-9", conversationExists: () => true }))).toBe("rollout-9");
  });

  it("falls back to treating the key as a rollout id", () => {
    expect(agentResumeId(KEY, facts({ conversationExists: () => true }))).toBe(KEY);
  });

  it("resumes nothing when the key names no rollout", () => {
    expect(agentResumeId(KEY, facts())).toBeNull();
  });

  // Carrying a resume id into a reattach starts a SECOND codex on a conversation that is
  // already running.
  it("never resumes when a live pty can be reattached", () => {
    expect(agentResumeId(KEY, facts({ hasLivePty: true, mappedId: "rollout-9" }))).toBeNull();
  });

  it("never resumes when a tmux session survived", () => {
    expect(agentResumeId(KEY, facts({ tmuxAlive: true, mappedId: "rollout-9" }))).toBeNull();
  });

  it("resumes nothing for a fresh session with no key", () => {
    expect(agentResumeId(null, facts({ conversationExists: () => true }))).toBeNull();
  });

  // The probe reads the filesystem; a reattach must not pay for an answer it discards.
  it("does not probe the disk when there is nothing to resume anyway", () => {
    const conversationExists = vi.fn().mockReturnValue(true);
    agentResumeId(KEY, facts({ hasLivePty: true, conversationExists }));
    agentResumeId(null, facts({ conversationExists }));
    expect(conversationExists).not.toHaveBeenCalled();
  });

  it("does not probe the disk when a mapped rollout already answers", () => {
    const conversationExists = vi.fn().mockReturnValue(true);
    expect(agentResumeId(KEY, facts({ mappedId: "rollout-9", conversationExists }))).toBe("rollout-9");
    expect(conversationExists).not.toHaveBeenCalled();
  });
});
