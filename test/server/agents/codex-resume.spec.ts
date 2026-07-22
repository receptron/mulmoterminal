// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

import { codexResumeId } from "../../../server/agents/codex-resume.js";

const KEY = "11111111-2222-4333-8444-555555555555";
const facts = (over: Partial<Parameters<typeof codexResumeId>[1]> = {}) => ({
  mappedRolloutId: null,
  rolloutExists: () => false,
  hasLivePty: false,
  tmuxAlive: false,
  ...over,
});

describe("codexResumeId", () => {
  // The browser-facing key and codex's rollout id are different namespaces, and a key can
  // look like either. A rollout we recorded FOR this key is the authoritative answer.
  it("prefers the rollout id recorded for the key", () => {
    expect(codexResumeId(KEY, facts({ mappedRolloutId: "rollout-9", rolloutExists: () => true }))).toBe("rollout-9");
  });

  it("falls back to treating the key as a rollout id", () => {
    expect(codexResumeId(KEY, facts({ rolloutExists: () => true }))).toBe(KEY);
  });

  it("resumes nothing when the key names no rollout", () => {
    expect(codexResumeId(KEY, facts())).toBeNull();
  });

  // Carrying a resume id into a reattach starts a SECOND codex on a conversation that is
  // already running.
  it("never resumes when a live pty can be reattached", () => {
    expect(codexResumeId(KEY, facts({ hasLivePty: true, mappedRolloutId: "rollout-9" }))).toBeNull();
  });

  it("never resumes when a tmux session survived", () => {
    expect(codexResumeId(KEY, facts({ tmuxAlive: true, mappedRolloutId: "rollout-9" }))).toBeNull();
  });

  it("resumes nothing for a fresh session with no key", () => {
    expect(codexResumeId(null, facts({ rolloutExists: () => true }))).toBeNull();
  });

  // The probe reads the filesystem; a reattach must not pay for an answer it discards.
  it("does not probe the disk when there is nothing to resume anyway", () => {
    const rolloutExists = vi.fn().mockReturnValue(true);
    codexResumeId(KEY, facts({ hasLivePty: true, rolloutExists }));
    codexResumeId(null, facts({ rolloutExists }));
    expect(rolloutExists).not.toHaveBeenCalled();
  });

  it("does not probe the disk when a mapped rollout already answers", () => {
    const rolloutExists = vi.fn().mockReturnValue(true);
    expect(codexResumeId(KEY, facts({ mappedRolloutId: "rollout-9", rolloutExists }))).toBe("rollout-9");
    expect(rolloutExists).not.toHaveBeenCalled();
  });
});
