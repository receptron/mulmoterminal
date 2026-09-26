import { describe, it, expect } from "vitest";
import { parseKeyBinding, parseKeySequence, sanitizeKeymap, sequenceBindings, validateKeymap } from "../../common/keymap";

// #2265. A binding can be two keystrokes, "Cmd+K p": the first starts a wait, the second picks the
// action. What the config accepts, rejects and warns about.
describe("parseKeySequence", () => {
  it.each([
    ["one keystroke", "PageDown", 1],
    ["two keystrokes", "Cmd+K p", 2],
    ["extra whitespace around and between", "  Ctrl+k   Shift+P ", 2],
  ])("reads %s", (_case, input, strokes) => {
    expect(parseKeySequence(input)?.length).toBe(strokes);
  });

  it.each([["Cmd+K p q"], [""], ["Cmd+K +"], ["Cmd+K Shift"], ["Nope+K p"]])("refuses %j", (input) => {
    expect(parseKeySequence(input)).toBeNull();
  });

  it("keeps each keystroke's modifiers apart", () => {
    expect(parseKeySequence("Cmd+K Shift+p")).toEqual([
      { key: "K", meta: true, shift: false, alt: false, ctrl: false },
      { key: "p", meta: false, shift: true, alt: false, ctrl: false },
    ]);
  });
});

// Before this, "Cmd+K p" parsed as ONE keystroke named "K p" — accepted, and never fired.
describe("parseKeyBinding", () => {
  it("refuses a key with whitespace in it", () => {
    expect(parseKeyBinding("Cmd+K p")).toBeNull();
  });
});

describe("validateKeymap with sequences", () => {
  it("accepts a sequence for a grid action", () => {
    expect(validateKeymap({ "files-find": "Cmd+k p" })).toEqual([]);
  });

  it("refuses three keystrokes", () => {
    expect(validateKeymap({ "files-find": "Cmd+k p q" })).toMatchObject([{ action: "files-find", fatal: true }]);
  });

  it.each([["copy"], ["paste"]])("refuses a sequence for %s, which is decided inside the terminal", (action) => {
    expect(validateKeymap({ [action]: "Cmd+k c" })).toMatchObject([{ action, fatal: true, reason: expect.stringContaining("single keystroke") }]);
  });

  it("refuses a sequence in `send`, whose key is still one keystroke", () => {
    expect(validateKeymap({ send: [{ key: "Cmd+k e", bytes: "\u0005" }] })).toMatchObject([{ action: "send[0]", fatal: true }]);
  });

  it("warns when a sequence's first key is bound on its own", () => {
    const problems = validateKeymap({ "zoom-toggle": "Cmd+k", "files-find": "Cmd+k p" });
    expect(problems).toMatchObject([{ action: "files-find", fatal: false, reason: expect.stringContaining("`zoom-toggle`") }]);
  });

  it.each([["copy"], ["paste"]])("warns when a sequence's first key is %s's", (action) => {
    const problems = validateKeymap({ [action]: "Cmd+k", "files-find": "Cmd+k p" });
    expect(problems).toMatchObject([{ action: "files-find", fatal: false, reason: expect.stringContaining("never starts") }]);
  });

  // An action that declines by view state leaves the key alive in the other state, and the
  // sequence starts there — "never" would be the wrong thing to tell the user (codex on #2283).
  it("says when a sequence still starts if its first key belongs to an action that declines by state", () => {
    const [problem] = validateKeymap({ "files-search": "Cmd+k", "files-find": "Cmd+k p" });
    expect(problem?.reason).toContain("only while a terminal is enlarged");
    expect(problem?.reason).toContain("starts only when none is");
  });

  it("warns when a sequence's first key is a send binding", () => {
    const problems = validateKeymap({ "files-find": "Cmd+k p", send: [{ key: "Cmd+k", bytes: "x" }] });
    expect(problems).toMatchObject([{ action: "files-find", fatal: false, reason: expect.stringContaining("`send[0]`") }]);
  });

  it("does not warn about two sequences sharing a first key — that is the point of one", () => {
    expect(validateKeymap({ "files-find": "Cmd+k p", "files-search": "Cmd+k f" })).toEqual([]);
  });

  it("warns when two actions claim the same sequence", () => {
    expect(validateKeymap({ "files-find": "Cmd+k p", "files-search": "cmd+k p" })).toMatchObject([{ action: "files-search", fatal: false }]);
  });

  it("warns that a bare Escape as the second key never fires — it always cancels", () => {
    expect(validateKeymap({ "files-find": "Cmd+k Escape" })).toMatchObject([{ action: "files-find", fatal: false, reason: expect.stringContaining("Escape") }]);
    expect(validateKeymap({ "files-find": "Cmd+k Shift+Escape" })).toEqual([]);
  });

  it("applies the macOS uppercase warning to the second keystroke too (#2125)", () => {
    expect(validateKeymap({ "files-find": "Cmd+k Cmd+Shift+P" })).toMatchObject([
      { action: "files-find", fatal: false, reason: expect.stringContaining('"p"') },
    ]);
  });
});

describe("sanitizeKeymap with sequences", () => {
  it("keeps a sequence for a grid action and drops one for copy", () => {
    expect(sanitizeKeymap({ "files-find": "Cmd+k p", copy: "Cmd+k c", paste: "Cmd+v" })).toEqual({ "files-find": "Cmd+k p", paste: "Cmd+v" });
  });
});

describe("sequenceBindings", () => {
  it("lists every two-key binding with how each key was written", () => {
    const [binding, ...rest] = sequenceBindings({ "zoom-toggle": "F8", "files-find": " Cmd+k  p ", copy: "Cmd+c" });
    expect(rest).toEqual([]);
    expect(binding).toMatchObject({ action: "files-find", firstLabel: "Cmd+k", secondLabel: "p" });
  });
});
