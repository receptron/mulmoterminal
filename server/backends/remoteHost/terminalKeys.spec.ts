// @vitest-environment node
import { describe, it, expect } from "vitest";

import { MAX_KEYS_PER_SEND, TERMINAL_KEY_NAMES, isTerminalKeyName, keyBytes, parseTerminalKeys } from "./terminalKeys.js";

const CONTROL_BYTE_MAX = 0x1f;
const DEL = 0x7f;
const C1_MAX = 0x9f;
const isControlByte = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code <= CONTROL_BYTE_MAX || (code >= DEL && code <= C1_MAX);
};

describe("keyBytes", () => {
  // The bytes a terminal emits for each key. Wrong bytes are silent — the menu simply
  // ignores them — so every one is pinned.
  it.each([
    ["up", "\x1b[A"],
    ["down", "\x1b[B"],
    ["right", "\x1b[C"],
    ["left", "\x1b[D"],
    ["escape", "\x1b"],
    ["tab", "\t"],
    ["shift-tab", "\x1b[Z"],
    ["backspace", "\x7f"],
    ["space", " "],
  ] as const)("presses %s as %j", (name, bytes) => {
    expect(keyBytes(name)).toBe(bytes);
  });

  it("presses a digit as itself", () => {
    expect(keyBytes("3")).toBe("3");
    expect(keyBytes("0")).toBe("0");
  });

  // Deliberate, and the kind of thing a later reader would "fix": `enter` is the KEY, plain
  // CR, and does NOT resolve the host's submit binding (#772). That binding describes
  // Claude's prompt box; a menu confirms on CR. sendTerminalInput still resolves it.
  it("presses enter as a plain CR, not the host's submit sequence", () => {
    expect(keyBytes("enter")).toBe("\r");
  });
});

describe("isTerminalKeyName", () => {
  it("accepts every advertised name", () => {
    expect(TERMINAL_KEY_NAMES.every(isTerminalKeyName)).toBe(true);
  });

  it("rejects a name that is not a key", () => {
    expect(isTerminalKeyName("f1")).toBe(false);
    expect(isTerminalKeyName("ctrl-c")).toBe(false);
    expect(isTerminalKeyName("Down")).toBe(false); // names are lower-case
  });

  // The phone chooses this string, and `in` would answer true for anything on
  // Object.prototype — the name would then be "known" but look up to a function.
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("rejects the prototype-chain name %j", (name) => {
    expect(isTerminalKeyName(name)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isTerminalKeyName(3)).toBe(false);
    expect(isTerminalKeyName(null)).toBe(false);
    expect(isTerminalKeyName(undefined)).toBe(false);
    expect(isTerminalKeyName(["down"])).toBe(false);
    expect(isTerminalKeyName({ down: true })).toBe(false);
  });

  // Nothing destructive is in the vocabulary: Ctrl-C interrupts the turn / kills a shell's
  // running process, and Ctrl-D / Ctrl-Z end or suspend the session. The phone can only ever
  // name a key, so no control byte may BE a name either.
  it("has no control byte reachable as a key name", () => {
    expect(TERMINAL_KEY_NAMES.some((name) => [...name].some(isControlByte))).toBe(false);
    expect(isTerminalKeyName("\x03")).toBe(false);
  });
});

describe("parseTerminalKeys", () => {
  it("returns the key names in order", () => {
    expect(parseTerminalKeys(["down", "down", "enter"])).toEqual(["down", "down", "enter"]);
  });

  it("takes a single key", () => {
    expect(parseTerminalKeys(["2"])).toEqual(["2"]);
  });

  it("takes the maximum allowed", () => {
    const keys = Array.from({ length: MAX_KEYS_PER_SEND }, () => "down");
    expect(parseTerminalKeys(keys)).toHaveLength(MAX_KEYS_PER_SEND);
  });

  it("refuses one key past the maximum", () => {
    const keys = Array.from({ length: MAX_KEYS_PER_SEND + 1 }, () => "down");
    expect(() => parseTerminalKeys(keys)).toThrow(/at most 16 keys/);
  });

  it("refuses an empty list", () => {
    expect(() => parseTerminalKeys([])).toThrow(/keys is required/);
  });

  it.each([[undefined], [null], ["down"], [3], [{ 0: "down" }]])("refuses %j, which is not an array", (value) => {
    expect(() => parseTerminalKeys(value)).toThrow(/keys must be an array/);
  });

  // The prefix it understood must NOT be pressed: a rejected send can be retried, but a key
  // that landed in a menu cannot be un-pressed.
  it("rejects the whole list when one name is unknown", () => {
    expect(() => parseTerminalKeys(["down", "f1", "enter"])).toThrow(/unknown key "f1"/);
  });

  it("names what is allowed when it rejects", () => {
    expect(() => parseTerminalKeys(["ctrl-c"])).toThrow(/allowed: .*\bdown\b/);
  });

  it("rejects a non-string entry", () => {
    expect(() => parseTerminalKeys([2])).toThrow(/unknown key 2/);
  });
});
