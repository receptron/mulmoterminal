import { describe, it, expect } from "vitest";
import { PREFIX_KEY_TIMEOUT_MS, prefixStep, type PendingPrefix } from "../../../src/composables/prefixKeys";
import type { ShortcutKeyEvent } from "../../../src/composables/gridShortcut";

// #2265. The wait between the two keys of a sequence, decided without a clock or a DOM.
const KEYMAP = { "files-find": "Ctrl+k p", "files-search": "Ctrl+k f", "zoom-toggle": "Ctrl+k Escape", "zoom-next": "F8" };

const key = (k: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  type: "keydown",
  key: k,
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  ...mods,
});
const CTRL_K = key("k", { ctrlKey: true });

const started = (at_ms = 0): PendingPrefix => {
  const step = prefixStep(KEYMAP, null, CTRL_K, at_ms);
  if (step.kind !== "wait") throw new Error("the prefix did not start");
  return step.pending;
};

describe("prefixStep", () => {
  it("starts a wait on a sequence's first key, with every action that can follow", () => {
    const pending = started();
    expect(pending.firstLabel).toBe("Ctrl+k");
    expect(pending.candidates.map((c) => c.action)).toEqual(["zoom-toggle", "files-find", "files-search"]);
  });

  it("runs the action the second key names", () => {
    expect(prefixStep(KEYMAP, started(), key("p"), 10)).toEqual({ kind: "run", action: "files-find" });
    expect(prefixStep(KEYMAP, started(), key("f"), 10)).toEqual({ kind: "run", action: "files-search" });
  });

  it("lets Escape be a second key when it is bound as one", () => {
    expect(prefixStep(KEYMAP, started(), key("Escape"), 10)).toEqual({ kind: "run", action: "zoom-toggle" });
  });

  it("cancels on a key nothing follows the prefix with", () => {
    expect(prefixStep(KEYMAP, started(), key("x"), 10)).toEqual({ kind: "cancel" });
    expect(prefixStep(KEYMAP, started(), key("p", { shiftKey: true }), 10)).toEqual({ kind: "cancel" }); // modifiers must match
  });

  it("cancels on Escape when Escape is not one of the second keys", () => {
    const keymap = { "files-find": "Ctrl+k p" };
    const step = prefixStep(keymap, null, CTRL_K, 0);
    if (step.kind !== "wait") throw new Error("the prefix did not start");
    expect(prefixStep(keymap, step.pending, key("Escape"), 10)).toEqual({ kind: "cancel" });
  });

  it.each([["Shift"], ["Control"], ["Alt"], ["Meta"]])("keeps waiting through a lone %s on the way to the second key", (modifier) => {
    expect(prefixStep(KEYMAP, started(), key(modifier), 10)).toEqual({ kind: "ignore" });
  });

  it("forgets a wait that has lapsed and reads the key afresh", () => {
    expect(prefixStep(KEYMAP, started(0), key("p"), PREFIX_KEY_TIMEOUT_MS)).toEqual({ kind: "pass" });
    expect(prefixStep(KEYMAP, started(0), CTRL_K, PREFIX_KEY_TIMEOUT_MS + 1)).toMatchObject({ kind: "wait" });
  });

  it("passes a key that starts no sequence, including a single binding", () => {
    expect(prefixStep(KEYMAP, null, key("p"), 0)).toEqual({ kind: "pass" });
    expect(prefixStep(KEYMAP, null, key("F8"), 0)).toEqual({ kind: "pass" });
  });

  it("passes a keyup and a key confirming an IME candidate, waiting or not", () => {
    expect(prefixStep(KEYMAP, null, { ...CTRL_K, type: "keyup" }, 0)).toEqual({ kind: "pass" });
    expect(prefixStep(KEYMAP, started(), key("p", { isComposing: true }), 10)).toEqual({ kind: "pass" });
  });

  it("passes everything when nothing is bound to a sequence", () => {
    expect(prefixStep({ "zoom-next": "F8" }, null, CTRL_K, 0)).toEqual({ kind: "pass" });
  });

  // The terminal decides these itself, after the grid. A sequence taking the key would disable an
  // existing copy / paste / send binding — and with it Ctrl+C's interrupt (codex on #2283).
  it.each([
    ["copy", { copy: "Ctrl+k", "files-find": "Ctrl+k p" }],
    ["paste", { paste: "Ctrl+k", "files-find": "Ctrl+k p" }],
    ["a send binding", { "files-find": "Ctrl+k p", send: [{ key: "Ctrl+k", bytes: "\u000b" }] }],
  ])("does not start a sequence on a key %s already takes", (_case, keymap) => {
    expect(prefixStep(keymap, null, CTRL_K, 0)).toEqual({ kind: "pass" });
  });
});
