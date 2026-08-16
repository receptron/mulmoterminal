// @vitest-environment node
//
// What a codex turn boundary tells the prompts pane.
//
// Codex has no hooks, so its rollout is the only place a prompt appears — and the repo's own reader
// says codex "writes its rollout lazily" and skips an in-flight turn on that basis
// (server/session/last-turn.ts, #254). If that is right, a pane refreshed only at turn START looks
// for a `user_message` that is not on disk yet, and nothing refreshes it afterwards: an open pane
// misses every codex prompt until some later turn begins (Codex, #1749).
//
// So both boundaries publish. Whichever way the flush timing actually goes, one of the two finds
// the prompt and the other is a redundant read of a file the pane was going to read anyway.
import { describe, it, expect, vi } from "vitest";
import { applyBoundary } from "../../../server/session/codex-activity-track.js";

const SESSION = "11111111-2222-4333-8444-555555555555";

const deps = () => ({
  setWorking: vi.fn(),
  setWaiting: vi.fn(),
  isActive: () => false,
  publishPromptSubmitted: vi.fn(),
  uiPort: "34567",
  isAlive: () => true,
});

describe("a codex turn tells the prompts pane to reload", () => {
  it("publishes at the START of a turn", () => {
    const d = deps();
    applyBoundary(SESSION, "started", d);
    expect(d.publishPromptSubmitted).toHaveBeenCalledWith(SESSION);
  });

  // The one that matters if the rollout really is written lazily: without it, the pane's only
  // reload happens ~400ms after the start, against a file that has nothing new in it yet.
  it("publishes again when the turn COMPLETES, once the rollout is certainly written", () => {
    const d = deps();
    applyBoundary(SESSION, "completed", d);
    expect(d.publishPromptSubmitted).toHaveBeenCalledWith(SESSION);
  });

  it("gives a whole turn two chances, in order", () => {
    const d = deps();
    applyBoundary(SESSION, "started", d);
    applyBoundary(SESSION, "completed", d);
    expect(d.publishPromptSubmitted).toHaveBeenCalledTimes(2);
  });

  // The activity flags are the other half of a boundary and must keep working: the signal is
  // published beside them, not instead of them.
  it("still drives the working flag it always did", () => {
    const d = deps();
    applyBoundary(SESSION, "started", d);
    expect(d.setWorking).toHaveBeenCalledWith(SESSION, true, "UserPromptSubmit");
    applyBoundary(SESSION, "completed", d);
    expect(d.setWorking).toHaveBeenCalledWith(SESSION, false, "Stop");
  });
});
