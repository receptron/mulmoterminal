import { describe, it, expect } from "vitest";
import { sanitizeDraftText, sanitizeMultilineText } from "../../../server/session/pty-text.js";

// This is the guard between untrusted text (a collection action, a custom view) and a
// live terminal. The draft is delivered wrapped in a bracketed paste, so any control
// byte that survives can close the paste early and run whatever follows as keystrokes.
describe("sanitizeDraftText", () => {
  it("keeps ordinary text intact", () => {
    expect(sanitizeDraftText("summarize the diff")).toBe("summarize the diff");
  });

  it("strips the bracketed-paste terminator so text cannot escape the paste", () => {
    // The ESC of an embedded "\e[201~" is what would end the paste early; without it
    // the rest is just characters typed into the input box.
    expect(sanitizeDraftText("safe\x1b[201~rm -rf /")).toBe("safe [201~rm -rf /");
  });

  it("strips a carriage return, which would submit the prompt early", () => {
    expect(sanitizeDraftText("first\rsecond")).toBe("first second");
  });

  it("strips ESC and Ctrl-C", () => {
    expect(sanitizeDraftText("a\x1bb\x03c")).toBe("a b c");
  });

  it("strips C1 control bytes, not just C0", () => {
    expect(sanitizeDraftText("a\x80b\x9fc")).toBe("a b c");
  });

  it("strips DEL", () => {
    expect(sanitizeDraftText("a\x7fb")).toBe("a b");
  });

  it("collapses the whitespace a stripped run leaves behind", () => {
    expect(sanitizeDraftText("a\x00\x01\x02b")).toBe("a b");
    expect(sanitizeDraftText("a \n\t b")).toBe("a b");
  });

  it("trims the edges", () => {
    expect(sanitizeDraftText("   padded  ")).toBe("padded");
  });

  it("reduces text that is only control bytes to an empty string", () => {
    // The callers treat "" as "nothing to type", so this is what makes a
    // control-bytes-only prompt a no-op rather than a stray paste.
    expect(sanitizeDraftText("\r\n")).toBe("");
    expect(sanitizeDraftText("\x1b\x03\x9b")).toBe("");
    expect(sanitizeDraftText("   ")).toBe("");
  });

  it("keeps non-ascii text, which is printable and not a control byte", () => {
    expect(sanitizeDraftText("日本語の指示 — ok")).toBe("日本語の指示 — ok");
  });

  it("keeps the characters bracketing a paste when they are ordinary text", () => {
    expect(sanitizeDraftText("use [200~ as a literal")).toBe("use [200~ as a literal");
  });
});

describe("sanitizeMultilineText", () => {
  it("keeps line structure", () => {
    expect(sanitizeMultilineText("first\nsecond\r\nthird")).toBe("first\nsecond\nthird");
  });

  it("strips control bytes without letting them reintroduce a line break", () => {
    expect(sanitizeMultilineText("a\x1b[201~b")).toBe("a [201~b");
    expect(sanitizeMultilineText("a\x03b")).toBe("a b");
    // A bare CR is a control byte, not one of the newlines this function emits.
    expect(sanitizeMultilineText("a\rb")).toBe("a b");
  });

  it("collapses runs of blank lines to a single separator", () => {
    expect(sanitizeMultilineText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims leading and trailing blank lines", () => {
    expect(sanitizeMultilineText("\n\n  a  \n\n")).toBe("a");
  });

  it("collapses horizontal runs but never merges two lines", () => {
    expect(sanitizeMultilineText("a  \t  b\n  c  ")).toBe("a b\nc");
  });

  it("is empty for empty and control-only input", () => {
    expect(sanitizeMultilineText("")).toBe("");
    expect(sanitizeMultilineText("\n\n\n")).toBe("");
    expect(sanitizeMultilineText("\x00\x03")).toBe("");
  });
});
