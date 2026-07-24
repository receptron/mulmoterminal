// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_TERMINAL_SUBMIT_MODE,
  TERMINAL_SUBMIT_MODES,
  isTerminalSubmitMode,
  submitSequence,
  newlineSequence,
  enterKeyOverride,
  type EnterKeyEvent,
  type TerminalSubmitMode,
} from "../../common/terminalSubmit.js";

const CR = "\r";
const ESC_CR = "\x1b\r";

describe("terminalSubmit constants", () => {
  it("defaults to the standard CR binding", () => {
    expect(DEFAULT_TERMINAL_SUBMIT_MODE).toBe("cr");
  });

  it("submit and newline are the two sequences, swapped per mode", () => {
    expect(submitSequence("cr")).toBe(CR);
    expect(newlineSequence("cr")).toBe(ESC_CR);
    expect(submitSequence("esc-cr")).toBe(ESC_CR);
    expect(newlineSequence("esc-cr")).toBe(CR);
  });

  // In every mode, submit and newline must be different bytes — else Enter and
  // Shift+Enter would be indistinguishable to the host.
  it.each(TERMINAL_SUBMIT_MODES)("submit and newline differ in %s mode", (mode) => {
    expect(submitSequence(mode)).not.toBe(newlineSequence(mode));
  });
});

describe("isTerminalSubmitMode", () => {
  it("accepts the known modes", () => {
    expect(isTerminalSubmitMode("cr")).toBe(true);
    expect(isTerminalSubmitMode("esc-cr")).toBe(true);
  });

  it.each([undefined, null, "", "CR", "enter", 1, {}, ["cr"]])("rejects %j", (v) => {
    expect(isTerminalSubmitMode(v)).toBe(false);
  });
});

describe("enterKeyOverride", () => {
  const ev = (over: Partial<EnterKeyEvent>): EnterKeyEvent => ({
    type: "keydown",
    key: "Enter",
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    ...over,
  });

  describe("cr mode (default — unchanged behaviour)", () => {
    const mode: TerminalSubmitMode = "cr";
    it("leaves a bare Enter to xterm's native \\r (submit)", () => {
      expect(enterKeyOverride(mode, ev({}))).toBeNull();
    });
    it("overrides Shift+Enter to the newline sequence (ESC+CR)", () => {
      expect(enterKeyOverride(mode, ev({ shiftKey: true }))).toBe(ESC_CR);
    });
    // Option/Alt+Enter is left to macOptionIsMeta (native ESC+CR) rather than intercepted,
    // exactly as before the setting existed.
    it("leaves Option/Alt+Enter native", () => {
      expect(enterKeyOverride(mode, ev({ altKey: true }))).toBeNull();
    });
    it("leaves Ctrl+Enter and Meta+Enter native", () => {
      expect(enterKeyOverride(mode, ev({ ctrlKey: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ metaKey: true }))).toBeNull();
    });
  });

  describe("esc-cr mode (reversed binding)", () => {
    const mode: TerminalSubmitMode = "esc-cr";
    it("intercepts a bare Enter to submit with ESC+CR", () => {
      expect(enterKeyOverride(mode, ev({}))).toBe(ESC_CR);
    });
    it("makes Shift+Enter a newline (CR)", () => {
      expect(enterKeyOverride(mode, ev({ shiftKey: true }))).toBe(CR);
    });
    // Overrides macOptionIsMeta's ESC+CR so Option/Alt+Enter is a newline, like Shift+Enter.
    it("makes Option/Alt+Enter a newline (CR)", () => {
      expect(enterKeyOverride(mode, ev({ altKey: true }))).toBe(CR);
      expect(enterKeyOverride(mode, ev({ altKey: true, shiftKey: true }))).toBe(CR);
    });
    it("leaves Ctrl+Enter and Meta+Enter native", () => {
      expect(enterKeyOverride(mode, ev({ ctrlKey: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ metaKey: true }))).toBeNull();
    });
  });

  // The IME guard is what keeps a Japanese candidate-confirm Enter from being eaten as a
  // submit in esc-cr mode — the one place a bare Enter is intercepted.
  it("never intercepts while an IME is composing", () => {
    for (const mode of TERMINAL_SUBMIT_MODES) {
      expect(enterKeyOverride(mode, ev({ isComposing: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ isComposing: true, shiftKey: true }))).toBeNull();
    }
  });

  it("ignores keyup and non-Enter keys in both modes", () => {
    for (const mode of TERMINAL_SUBMIT_MODES) {
      expect(enterKeyOverride(mode, ev({ type: "keyup" }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ type: "keyup", shiftKey: true }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ key: "a" }))).toBeNull();
      expect(enterKeyOverride(mode, ev({ key: "a", shiftKey: true }))).toBeNull();
    }
  });
});
