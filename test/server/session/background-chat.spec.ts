import { describe, it, expect } from "vitest";
import { backgroundChatMessage, parseBackgroundChat, spawnModeFor } from "../../../server/session/background-chat.js";

const SESSION = "11111111-2222-3333-4444-555555555555";
const ok = (body: unknown) => {
  const parsed = parseBackgroundChat(body);
  if (!parsed.ok) throw new Error(`expected a request, got: ${parsed.message}`);
  return parsed.request;
};

// The body comes from an agent tool call, so it is whatever a model produced. Every field
// has to read as absent unless it is exactly what we accept.
describe("parseBackgroundChat", () => {
  it("accepts a plain message and defaults the rest", () => {
    expect(ok({ message: "look at the failing test" })).toEqual({
      agent: "claude",
      draft: false,
      hidden: false,
      message: "look at the failing test",
    });
  });

  it("trims the message", () => {
    expect(ok({ message: "  spaced  " }).message).toBe("spaced");
  });

  describe("rejection", () => {
    const rejected = (body: unknown) => {
      const parsed = parseBackgroundChat(body);
      expect(parsed.ok).toBe(false);
      return parsed.ok ? "" : parsed.message;
    };

    it("refuses a missing, empty or whitespace-only message", () => {
      // Spawning on an empty message would leave the user an idle session with no task.
      expect(rejected({})).toMatch(/`message` is required/);
      expect(rejected({ message: "" })).toMatch(/`message` is required/);
      expect(rejected({ message: "   " })).toMatch(/`message` is required/);
    });

    it("refuses a message that is not a string", () => {
      for (const message of [42, ["hi"], null, { text: "hi" }]) {
        expect(rejected({ message })).toMatch(/`message` is required/);
      }
    });

    it("refuses a body that is not an object", () => {
      for (const body of [null, undefined, "just a string", 42, []]) {
        expect(rejected(body)).toMatch(/`message` is required/);
      }
    });
  });

  describe("flags", () => {
    it("takes draft only when it is exactly true", () => {
      // A model may pass "true" or 1; anything but the boolean must run the prompt
      // rather than silently leaving it unsent in the input box.
      expect(ok({ message: "m", draft: true }).draft).toBe(true);
      expect(ok({ message: "m", draft: "true" }).draft).toBe(false);
      expect(ok({ message: "m", draft: 1 }).draft).toBe(false);
      expect(ok({ message: "m" }).draft).toBe(false);
    });

    it("takes hidden only when it is exactly true", () => {
      expect(ok({ message: "m", hidden: true }).hidden).toBe(true);
      expect(ok({ message: "m", hidden: "yes" }).hidden).toBe(false);
    });

    it("takes codex only for that exact string, and defaults to claude", () => {
      expect(ok({ message: "m", agent: "codex" }).agent).toBe("codex");
      expect(ok({ message: "m", agent: "Codex" }).agent).toBe("claude");
      expect(ok({ message: "m", agent: "gpt" }).agent).toBe("claude");
      expect(ok({ message: "m" }).agent).toBe("claude");
    });
  });
});

describe("spawnModeFor", () => {
  it("runs a claude prompt by default", () => {
    expect(spawnModeFor("claude", false)).toBe("claude-run");
  });

  it("drafts a claude prompt when asked", () => {
    expect(spawnModeFor("claude", true)).toBe("claude-draft");
  });

  it("runs a codex prompt whether or not a draft was asked for", () => {
    // codex has no editable-draft path — no stable TUI ready-marker to type against —
    // so a codex draft has to become a run rather than nothing at all.
    expect(spawnModeFor("codex", false)).toBe("codex-run");
    expect(spawnModeFor("codex", true)).toBe("codex-run");
  });
});

describe("backgroundChatMessage", () => {
  it("says the codex session is already running", () => {
    const text = backgroundChatMessage("codex", false, SESSION);
    expect(text).toContain(SESSION);
    expect(text).toMatch(/auto-running/);
  });

  it("says a draft is waiting for the user rather than running", () => {
    // The caller decides what to tell the user next, so a draft must not read as started.
    const text = backgroundChatMessage("claude", true, SESSION);
    expect(text).toMatch(/prefilled/);
    expect(text).not.toMatch(/runs in parallel/);
  });

  it("says a claude run is working in parallel", () => {
    const text = backgroundChatMessage("claude", false, SESSION);
    expect(text).toMatch(/runs in parallel/);
    expect(text).not.toMatch(/prefilled/);
  });

  it("always carries the session id, which is how the caller reopens it", () => {
    for (const [agent, draft] of [
      ["claude", false],
      ["claude", true],
      ["codex", false],
    ] as const) {
      expect(backgroundChatMessage(agent, draft, SESSION)).toContain(SESSION);
    }
  });
});
