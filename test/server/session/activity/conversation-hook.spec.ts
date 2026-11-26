// @vitest-environment node
import { describe, it, expect } from "vitest";
import { speaksForConversation } from "../../../../server/session/activity/conversation-hook";

describe("speaksForConversation", () => {
  it.each(["clear", "resume", "fork", "compact", undefined, null, "", "Startup", 42])("a SessionStart from %s does", (source) => {
    expect(speaksForConversation("SessionStart", source)).toBe(true);
  });

  // Claude Code's pre-warmed background spare announces itself this way, under an id of its own.
  it("a SessionStart from startup does not", () => {
    expect(speaksForConversation("SessionStart", "startup")).toBe(false);
  });

  it.each(["UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStop", "Notification", "PermissionRequest", ""])(
    "%s does, whatever its source",
    (event) => {
      expect(speaksForConversation(event, undefined)).toBe(true);
      expect(speaksForConversation(event, "startup")).toBe(true);
    },
  );

  it.each([undefined, "clear", "startup", "logout", "other"])("a SessionEnd does not, from %s", (reason) => {
    expect(speaksForConversation("SessionEnd", reason)).toBe(false);
  });
});
