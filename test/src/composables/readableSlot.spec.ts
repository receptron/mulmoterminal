import { describe, it, expect } from "vitest";
import { readableSlot, type SlotCandidate } from "../../../src/composables/readableSlot";

// A slot that IS readable; each test flips one field to check that field's rule.
const readable = (over: Partial<SlotCandidate> = {}): SlotCandidate => ({
  key: "cell-2",
  connected: true,
  isCommand: false,
  isShellLauncher: false,
  sessionId: "sess-2",
  cwd: "/w/proj",
  codex: false,
  ...over,
});

describe("readableSlot", () => {
  it("reads a connected agent cell", () => {
    expect(readableSlot(readable())).toEqual({ key: "cell-2", sessionId: "sess-2", cwd: "/w/proj", agent: "claude" });
  });

  it("reports a codex cell as codex, so its rollout is read rather than a transcript", () => {
    expect(readableSlot(readable({ codex: true }))?.agent).toBe("codex");
  });

  it("drops a slot with no session id — the id is what locates the log", () => {
    expect(readableSlot(readable({ sessionId: null }))).toBeNull();
    expect(readableSlot(readable({ sessionId: "" }))).toBeNull();
  });

  it("drops a disconnected slot", () => {
    expect(readableSlot(readable({ connected: false }))).toBeNull();
  });

  it("drops a command cell — captured output, not a conversation", () => {
    expect(readableSlot(readable({ isCommand: true }))).toBeNull();
  });

  it("drops a plain shell — no agent, so no log", () => {
    expect(readableSlot(readable({ isShellLauncher: true }))).toBeNull();
  });

  it("keeps a slot whose cwd the server hasn't reported yet", () => {
    expect(readableSlot(readable({ cwd: null }))).toEqual({ key: "cell-2", sessionId: "sess-2", cwd: null, agent: "claude" });
  });

  it("drops a slot failing several rules at once", () => {
    expect(readableSlot(readable({ connected: false, sessionId: null, isCommand: true }))).toBeNull();
  });
});
