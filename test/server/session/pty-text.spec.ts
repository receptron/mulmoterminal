import { describe, it, expect } from "vitest";
import { sanitizeDraftText, sanitizeMultilineText } from "../../../server/session/pty-text.js";

const ESC = "\u001B";
const NUL = "\u0000";
const ETX = "\u0003"; // Ctrl-C
const CSI = "\u009B"; // the C1 single-byte form of ESC [

describe("sanitizeDraftText", () => {
  it("collapses a multi-line draft onto one line", () => {
    expect(sanitizeDraftText("first\nsecond\r\nthird")).toBe("first second third");
  });

  it("strips the escape sequences an untrusted excerpt could use to break out", () => {
    expect(sanitizeDraftText(`hi${ESC}[201~ rm -rf /`)).toBe("hi [201~ rm -rf /");
    expect(sanitizeDraftText(`hi${ETX}there`)).toBe("hi there");
    expect(sanitizeDraftText(`hi${CSI}there`)).toBe("hi there");
    expect(sanitizeDraftText(`hi${NUL}there`)).toBe("hi there");
  });

  it("is empty for empty and control-only input", () => {
    expect(sanitizeDraftText("")).toBe("");
    expect(sanitizeDraftText("\n\r\t")).toBe("");
  });

  it("leaves printable non-ASCII text intact", () => {
    expect(sanitizeDraftText("レビューして 👍")).toBe("レビューして 👍");
  });
});

describe("sanitizeMultilineText", () => {
  it("keeps line structure", () => {
    expect(sanitizeMultilineText("first\nsecond\r\nthird")).toBe("first\nsecond\nthird");
  });

  it("strips control bytes without letting them reintroduce a line break", () => {
    expect(sanitizeMultilineText(`a${ESC}[201~b`)).toBe("a [201~b");
    expect(sanitizeMultilineText(`a${ETX}b`)).toBe("a b");
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
    expect(sanitizeMultilineText(`${NUL}${ETX}`)).toBe("");
  });
});
