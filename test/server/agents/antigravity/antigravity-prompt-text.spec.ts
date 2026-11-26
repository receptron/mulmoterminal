// @vitest-environment node
import { describe, it, expect } from "vitest";
import { antigravityPromptText } from "../../../../server/agents/antigravity/antigravity-prompt-text.js";

const METADATA = "<ADDITIONAL_METADATA>\nThe current local time is: 2026-05-21T07:06:29+09:00.\n</ADDITIONAL_METADATA>";
const SETTINGS = "<USER_SETTINGS_CHANGE>\nThe user picked a model.\n</USER_SETTINGS_CHANGE>";
// The shape agy 1.5 writes when the user approves a plan in its own UI, path rewritten.
const APPROVAL = `Comments on artifact URI: file:///home/u/.gemini/antigravity/brain/c1/implementation_plan.md\n\nThe user has approved this document.\n\n\n<USER_REQUEST>\n\n</USER_REQUEST>\n${METADATA}`;

const text = (content: string): string => antigravityPromptText(content).trim();

describe("antigravityPromptText", () => {
  it("takes the request inside the wrapper, without agy's appended blocks", () => {
    expect(text(`<USER_REQUEST>\nhello\n</USER_REQUEST>\n${METADATA}\n${SETTINGS}`)).toBe("hello");
  });

  it("keeps a request that itself contains the opening tag of an appended block", () => {
    expect(text(`<USER_REQUEST>\nwhat is <ADDITIONAL_METADATA>?\n</USER_REQUEST>\n${METADATA}`)).toBe("what is <ADDITIONAL_METADATA>?");
  });

  it("takes the inside of the wrapper even when agy wrote something above it", () => {
    expect(text(`Comments on artifact URI: file:///x.md\n\n<USER_REQUEST>\nplease rename it\n</USER_REQUEST>\n${METADATA}`)).toBe("please rename it");
  });

  it("falls back to what agy wrote outside its blocks when the request is empty: an artifact approval", () => {
    expect(text(APPROVAL)).toBe(
      "Comments on artifact URI: file:///home/u/.gemini/antigravity/brain/c1/implementation_plan.md\n\nThe user has approved this document.",
    );
  });

  it("treats a request of only whitespace as empty", () => {
    expect(text(`Approved.\n<USER_REQUEST>\n  \t\n</USER_REQUEST>`)).toBe("Approved.");
  });

  it("is empty when the request is empty and nothing else was written", () => {
    expect(text(`<USER_REQUEST>\n\n</USER_REQUEST>\n${METADATA}`)).toBe("");
    expect(text("")).toBe("");
  });

  it("keeps an unwrapped step's text, dropping only the blocks it knows", () => {
    expect(text(`a shape not seen yet\n${METADATA}`)).toBe("a shape not seen yet");
  });
});
