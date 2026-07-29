// @vitest-environment node
import { describe, it, expect } from "vitest";

import { MEMO_MAX_LENGTH, normalizeMemo, sessionDisplayName } from "../../common/sessionMemo.js";

describe("normalizeMemo", () => {
  it("keeps an ordinary one-line note as it was typed", () => {
    expect(normalizeMemo("#1077 のリサイズを検証中")).toBe("#1077 のリサイズを検証中");
  });

  // The memo renders on ONE header line, so anything that would break out of it is folded into a
  // space rather than dropped — a pasted two-line note keeps both halves readable.
  it("folds newlines and tabs into single spaces", () => {
    expect(normalizeMemo("first line\nsecond line")).toBe("first line second line");
    expect(normalizeMemo("a\r\n\tb")).toBe("a b");
  });

  // A terminal paste carries escape sequences. Left in, they reach an HTML attribute and a JSON
  // log line, and the header shows an invisible gap where the note should be.
  it("strips the control characters a terminal paste carries", () => {
    expect(normalizeMemo("before\u001b[31mafter")).toBe("before [31mafter");
    expect(normalizeMemo("bell\u0007end")).toBe("bell end");
  });

  it("trims and collapses runs of whitespace", () => {
    expect(normalizeMemo("   spaced    out   ")).toBe("spaced out");
  });

  // "" is the ERASE value, which is why whitespace-only input has to reach it: selecting the note
  // and typing a space is how a user says "drop this".
  it("normalizes an empty or whitespace-only note to the erase value", () => {
    expect(normalizeMemo("")).toBe("");
    expect(normalizeMemo("   ")).toBe("");
    expect(normalizeMemo("\n\t ")).toBe("");
  });

  it("refuses anything that is not a string", () => {
    expect(normalizeMemo(undefined)).toBe("");
    expect(normalizeMemo(null)).toBe("");
    expect(normalizeMemo(42)).toBe("");
    expect(normalizeMemo({ text: "hello" })).toBe("");
  });

  it("caps a long note", () => {
    expect(normalizeMemo("x".repeat(MEMO_MAX_LENGTH + 50))).toHaveLength(MEMO_MAX_LENGTH);
    expect(normalizeMemo("x".repeat(MEMO_MAX_LENGTH))).toHaveLength(MEMO_MAX_LENGTH);
  });

  // By code point: a cap landing inside a surrogate pair would leave a lone half in the JSON line
  // that every later reader has to carry.
  it("caps by code point, never inside a surrogate pair", () => {
    const capped = normalizeMemo("𝕏".repeat(MEMO_MAX_LENGTH + 10));
    expect([...capped]).toHaveLength(MEMO_MAX_LENGTH);
    expect(capped).toBe("𝕏".repeat(MEMO_MAX_LENGTH));
  });

  it("counts a multi-byte note by characters, not bytes", () => {
    expect(normalizeMemo("あ".repeat(MEMO_MAX_LENGTH - 1))).toHaveLength(MEMO_MAX_LENGTH - 1);
  });

  it("leaves quotes, backslashes and markup alone — the log line is JSON, not a delimiter", () => {
    expect(normalizeMemo('branch "fix/1084" — C:\\repo <b>x</b>')).toBe('branch "fix/1084" — C:\\repo <b>x</b>');
  });
});

// The rule the cell header, the sidebar row and the phone's roster all share. It lives here so a
// session cannot go by two names depending on which of the three is looked at.
describe("sessionDisplayName", () => {
  it("lets the user's memo outrank every generated title", () => {
    expect(sessionDisplayName("release check", "Login fix", "fix the login bug")).toBe("release check");
  });

  it("falls through the generated tiers in the order it was given them", () => {
    expect(sessionDisplayName(null, "Login fix", "fix the login bug")).toBe("Login fix");
    expect(sessionDisplayName(null, null, "fix the login bug")).toBe("fix the login bug");
  });

  // Truthiness, not nullishness: every tier is a string that must be SKIPPED when empty. Pinning
  // "" as the answer would hide the real title sitting in the tier below it.
  it("skips an empty tier rather than showing blank", () => {
    expect(sessionDisplayName("", "Login fix")).toBe("Login fix");
    expect(sessionDisplayName(undefined, "", "fix the login bug")).toBe("fix the login bug");
  });

  // "" is what a caller checks to reach for its OWN fallback — a short session id in the grid, a
  // sentinel in the sidebar — so nothing-at-all must not become a name.
  it("answers empty when there is nothing to show", () => {
    expect(sessionDisplayName(null)).toBe("");
    expect(sessionDisplayName("", "", null, undefined)).toBe("");
  });
});
