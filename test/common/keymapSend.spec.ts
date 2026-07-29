import { describe, it, expect } from "vitest";
import { sanitizeKeymap, sendBytesFor, validateKeymap, type Keymap } from "../../common/keymap.js";

// #1005 — a key that puts bytes into the terminal instead of running an app action.
//
// The payloads here are written as JSON writes them: CTRL_E is Ctrl+E (end of line) and CTRL_A is
// Ctrl+A (start of line), which is what the requester wanted Cmd+Right / Cmd+Left to do.
const CTRL_E = "\u0005";
const CTRL_A = "\u0001";

const keydown = (over: Partial<{ key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) => ({
  type: "keydown",
  key: "ArrowRight",
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: true,
  ...over,
});

const withSend = (send: Keymap["send"]): Keymap => ({ ...(send ? { send } : {}) });

describe("sendBytesFor", () => {
  it("returns the bound bytes for a matching keystroke", () => {
    const keymap = withSend([{ key: "Cmd+ArrowRight", bytes: CTRL_E }]);
    expect(sendBytesFor(keymap, keydown())).toBe(CTRL_E);
  });

  it("tells two bindings apart", () => {
    const keymap = withSend([
      { key: "Cmd+ArrowRight", bytes: CTRL_E },
      { key: "Cmd+ArrowLeft", bytes: CTRL_A },
    ]);
    expect(sendBytesFor(keymap, keydown({ key: "ArrowRight" }))).toBe(CTRL_E);
    expect(sendBytesFor(keymap, keydown({ key: "ArrowLeft" }))).toBe(CTRL_A);
  });

  // The reason this feature is a LIST and not one more action: the payload differs per key, so a
  // single `send: "..."` field could only ever name one of them.
  it("carries a different payload per key, which one field could not", () => {
    const keymap = withSend([
      { key: "Alt+b", bytes: "\u001bb" },
      { key: "Alt+f", bytes: "\u001bf" },
    ]);
    expect(sendBytesFor(keymap, keydown({ key: "b", altKey: true, metaKey: false }))).toBe("\u001bb");
    expect(sendBytesFor(keymap, keydown({ key: "f", altKey: true, metaKey: false }))).toBe("\u001bf");
  });

  it("requires every modifier to match, so Shift+Cmd+Right is not Cmd+Right", () => {
    const keymap = withSend([{ key: "Cmd+ArrowRight", bytes: CTRL_E }]);
    expect(sendBytesFor(keymap, keydown({ shiftKey: true }))).toBeNull();
  });

  it("ignores keyup and IME composition, like every other binding", () => {
    const keymap = withSend([{ key: "Cmd+ArrowRight", bytes: CTRL_E }]);
    expect(sendBytesFor(keymap, { ...keydown(), type: "keyup" })).toBeNull();
    expect(sendBytesFor(keymap, keydown({ isComposing: true }))).toBeNull();
  });

  it("is null with no send list at all, so an unconfigured install takes no key", () => {
    expect(sendBytesFor({}, keydown())).toBeNull();
    expect(sendBytesFor({ "zoom-next": "Cmd+ArrowRight" }, keydown())).toBeNull();
  });

  it("skips an unparseable key rather than throwing", () => {
    const keymap = withSend([
      { key: "Cmd++", bytes: "x" },
      { key: "Cmd+ArrowRight", bytes: CTRL_E },
    ]);
    expect(sendBytesFor(keymap, keydown())).toBe(CTRL_E);
  });

  it("uses the first entry when a keystroke is listed twice", () => {
    const keymap = withSend([
      { key: "Cmd+ArrowRight", bytes: CTRL_E },
      { key: "Cmd+ArrowRight", bytes: CTRL_A },
    ]);
    expect(sendBytesFor(keymap, keydown())).toBe(CTRL_E);
  });
});

describe("validateKeymap — send", () => {
  const reasons = (input: unknown) => validateKeymap(input).map((p) => `${p.action}: ${p.reason}`);

  it("accepts a well-formed list", () => {
    expect(validateKeymap({ send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] })).toEqual([]);
  });

  it("refuses a send that is not an array", () => {
    const problems = validateKeymap({ send: { "Cmd+ArrowRight": CTRL_E } });
    expect(problems).toHaveLength(1);
    expect(problems[0].fatal).toBe(true);
  });

  it.each([
    ["a missing bytes", { key: "Cmd+ArrowRight" }],
    ["a missing key", { bytes: CTRL_E }],
    ["a bare string", "Cmd+ArrowRight"],
  ])("refuses %s", (_case, entry) => {
    const problems = validateKeymap({ send: [entry] });
    expect(problems.map((p) => p.action)).toEqual(["send[0]"]);
    expect(problems[0].fatal).toBe(true);
  });

  it("refuses an unparseable key, naming which entry", () => {
    expect(reasons({ send: [{ key: "Nope+ArrowRight", bytes: CTRL_E }] })[0]).toMatch(/^send\[0\]: unparseable/);
  });

  // Empty bytes would take the key away from the terminal and put nothing back, which reads as
  // "this key stopped working" — worse than an unbound key.
  it("refuses empty bytes", () => {
    const problems = validateKeymap({ send: [{ key: "Cmd+ArrowRight", bytes: "" }] });
    expect(problems[0].fatal).toBe(true);
    expect(problems[0].reason).toMatch(/empty/);
  });

  it("reports the offending index, not just that something is wrong", () => {
    const problems = validateKeymap({
      send: [
        { key: "Cmd+ArrowRight", bytes: CTRL_E },
        { key: "Cmd++", bytes: CTRL_A },
      ],
    });
    expect(problems.map((p) => p.action)).toEqual(["send[1]"]);
  });
});

// The collision rule, and it is NOT a toss-up: the grid's handler listens on `window` in the
// CAPTURE phase and calls stopPropagation(), so the event never reaches the terminal's xterm.
// An action always wins, and the send binding silently never fires — which is exactly why it
// has to be warned about rather than left to be discovered by pressing the key.
describe("validateKeymap — a send and an action on one keystroke", () => {
  const both = { "zoom-next": "Cmd+ArrowRight", send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] };

  it("warns, and names the action as the winner", () => {
    const problems = validateKeymap(both);
    expect(problems).toHaveLength(1);
    expect(problems[0].action).toBe("send[0]");
    expect(problems[0].reason).toContain("zoom-next");
    expect(problems[0].fatal).toBe(false); // a shortcut lost, not a config that cannot load
  });

  it("names the action even when the send entry is written FIRST in the file", () => {
    const problems = validateKeymap({ send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }], "zoom-next": "Cmd+ArrowRight" });
    expect(problems[0].action).toBe("send[0]");
    expect(problems[0].reason).toContain("zoom-next");
  });

  it("warns about the later of two send entries claiming one keystroke", () => {
    const problems = validateKeymap({
      send: [
        { key: "Cmd+ArrowRight", bytes: CTRL_E },
        { key: "cmd+ArrowRight", bytes: CTRL_A },
      ],
    });
    expect(problems.map((p) => p.action)).toEqual(["send[1]"]);
    expect(problems[0].reason).toContain("send[0]");
  });
});

describe("sanitizeKeymap — send", () => {
  it("keeps a valid list alongside the action bindings", () => {
    const keymap = sanitizeKeymap({ "zoom-next": "PageDown", send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] });
    expect(keymap).toEqual({ "zoom-next": "PageDown", send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] });
  });

  it("drops the malformed entries and keeps the rest", () => {
    const keymap = sanitizeKeymap({
      send: [{ key: "Cmd++", bytes: "x" }, { key: "Cmd+ArrowRight", bytes: CTRL_E }, { key: "Cmd+k", bytes: "" }, { nope: 1 }],
    });
    expect(keymap.send).toEqual([{ key: "Cmd+ArrowRight", bytes: CTRL_E }]);
  });

  // Absent and emptied must look the same downstream, so nothing has to test for both.
  it.each([
    ["a non-array", { send: "nope" }],
    ["an all-invalid list", { send: [{ key: "Cmd++", bytes: "x" }] }],
    ["an empty list", { send: [] }],
  ])("omits send entirely for %s", (_case, input) => {
    expect(sanitizeKeymap(input)).not.toHaveProperty("send");
  });

  it("survives the round trip a config takes, so a saved binding still fires", () => {
    const keymap = sanitizeKeymap(JSON.parse(JSON.stringify({ send: [{ key: "Cmd+ArrowRight", bytes: CTRL_E }] })));
    expect(sendBytesFor(keymap, keydown())).toBe(CTRL_E);
  });
});
