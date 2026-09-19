// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { PromptMonitor } from "../../../server/bots/prompt-monitor.js";
import { botScreen, choiceScreen } from "../../../server/bots/prompt-screen.js";
import { idleScreen, resumeScreen, permissionScreen } from "./prompt-fixtures.js";

describe("CLI question recognition", () => {
  it("recognizes summary confirmation and ignores cursor changes in its identity", () => {
    const first = choiceScreen(resumeScreen("1"));
    const second = choiceScreen(resumeScreen("2"));
    expect(first?.prompt.kind).toBe("resume-summary");
    expect(first?.prompt.fingerprint).toBe(second?.prompt.fingerprint);
    expect(second?.selected).toBe("2");
    expect(choiceScreen(`\u001b[32m${resumeScreen()}\u001b[0m`)?.prompt.kind).toBe("resume-summary");
  });
  it("does not treat permission menus or partial summary text as automatic summary consent", () => {
    expect(botScreen(permissionScreen()).prompt?.kind).toBe("choice");
    expect(choiceScreen(resumeScreen().replace("Resume full session as-is", "Allow shell access"))?.prompt.kind).toBe("choice");
    expect(choiceScreen(resumeScreen().replace("Resuming the full session will consume", "A quote describing"))?.prompt.kind).toBe("choice");
  });
  it("ignores old menus above the actual prompt and refuses ambiguous/unrecognized selections", () => {
    expect(botScreen(resumeScreen() + idleScreen)).toEqual({ idle: true, prompt: null });
    expect(choiceScreen(resumeScreen().replace("❯", " "))).toBeNull();
    expect(choiceScreen(resumeScreen().replace("  1.", "❯ 1."))).toBeNull();
    expect(choiceScreen(resumeScreen().replace("  3.", "  2."))).toBeNull();
    expect(choiceScreen(resumeScreen() + "another screen")).toBeNull();
    expect(botScreen("Sign in\nPaste your authentication code:").prompt?.kind).toBe("unknown");
    expect(botScreen("Working…\nesc to interrupt").prompt).toBeNull();
  });
  it("records menus with wrapped choices as unrecognized instead of guessing key mappings", () => {
    const raw = permissionScreen().replace("1. Yes", "1. Yes\n  some wrapped explanation");
    expect(botScreen(raw).prompt?.kind).toBe("unknown");
    expect(botScreen(raw).prompt?.options).toEqual([]);
    expect(botScreen(permissionScreen().replace("Enter to select", "Space to toggle · Enter to submit")).prompt?.kind).toBe("unknown");
  });
});

describe("missing hook diagnostics", () => {
  it("reports a stable outstanding request without asserting that the CLI has stopped", () => {
    vi.useFakeTimers();
    try {
      const monitor = new PromptMonitor();
      expect(monitor.inspect("bot", "An unfamiliar screen", true).prompt).toBeNull();
      vi.advanceTimersByTime(120000);
      expect(monitor.inspect("bot", "An unfamiliar screen", true).prompt).toMatchObject({
        kind: "unknown",
        options: [],
        message: expect.stringContaining("may still be running"),
      });
      monitor.touch("bot"); // a new lifecycle hook demonstrates progress
      expect(monitor.inspect("bot", "An unfamiliar screen", true).prompt).toBeNull();
      vi.advanceTimersByTime(120000);
      expect(monitor.inspect("bot", "An unfamiliar screen", false).prompt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
