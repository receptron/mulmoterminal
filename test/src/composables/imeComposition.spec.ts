// The shared "is this key confirming an IME candidate?" answer, and the two handlers that ask it.
//
// Both handlers already refuse `event.isComposing`, which is the Chrome / Firefox shape. What is
// pinned here is the SAFARI shape: compositionend has already fired, so the flag is false, and
// without the window the keystroke that only meant to accept 変換 reaches the pty or a shortcut
// (#1353).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { isImeConfirming, resetImeComposition, xtermImeKeyVerdict } from "../../../src/composables/imeComposition";
import { SAFARI_IME_RACE_WINDOW_MS } from "../../../src/composables/useImeAwareEnter";

const enter = (over: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ type: "keydown", key: "Enter", isComposing: false, ...over }) as unknown as KeyboardEvent;

/** Composition events as the browser fires them, on the window the module listens to. */
const fire = (type: "compositionstart" | "compositionend") => window.dispatchEvent(new Event(type));

beforeEach(() => resetImeComposition());
afterEach(() => {
  vi.useRealTimers();
  resetImeComposition();
});

describe("isImeConfirming", () => {
  it("is false for an ordinary keystroke", () => {
    expect(isImeConfirming(enter())).toBe(false);
  });

  it("is true while the event itself says it is composing", () => {
    expect(isImeConfirming(enter({ isComposing: true }))).toBe(true);
  });

  // The module listens on `window` in capture, so a composition anywhere on the page counts —
  // xterm's helper textarea included, which is the whole reason it is not per-component state.
  it("is true between compositionstart and compositionend, wherever they were fired", () => {
    fire("compositionstart");
    expect(isImeConfirming(enter())).toBe(true);

    fire("compositionend");
    expect(isImeConfirming(enter())).toBe(true); // still inside the Safari window
  });

  // Safari's ordering: compositionend, THEN the confirming keydown with isComposing already false.
  it("is true for the keystroke that immediately follows compositionend", () => {
    fire("compositionstart");
    fire("compositionend");
    expect(isImeConfirming(enter({ isComposing: false }))).toBe(true);
  });

  it("is false again once the window has passed", async () => {
    fire("compositionstart");
    fire("compositionend");
    await new Promise((r) => setTimeout(r, SAFARI_IME_RACE_WINDOW_MS + 20));
    expect(isImeConfirming(enter())).toBe(false);
  });

  // The state is module-level, so it does NOT go away with a component the way per-instance state
  // would. A composition abandoned without its `compositionend` — a tab switch, an input torn down
  // mid-word — would otherwise leave the flag set and suppress every later keystroke: no grid
  // shortcuts and no terminal Enter until reload. Worse than the bug this module prevents.
  it("forgets a composition abandoned without compositionend, on losing focus", () => {
    fire("compositionstart");
    expect(isImeConfirming(enter())).toBe(true);

    window.dispatchEvent(new Event("blur"));

    expect(isImeConfirming(enter())).toBe(false);
  });

  // `blur` does not bubble; the listener is in capture on `window` so an element's blur is seen on
  // the way down. Pinning it because a plain (bubbling) listener would silently miss this one.
  it("forgets it when the element that was composing blurs", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    fire("compositionstart");
    expect(isImeConfirming(enter())).toBe(true);

    input.dispatchEvent(new Event("blur")); // not bubbling — only capture on window sees it

    expect(isImeConfirming(enter())).toBe(false);
    input.remove();
  });
});

describe("xtermImeKeyVerdict", () => {
  const meta = (isComposing: boolean) => enter({ key: "Meta", isComposing });

  it("withholds a Meta keydown during a composition (xtermjs/xterm.js#6244)", () => {
    expect(xtermImeKeyVerdict(meta(true))).toBe(false);
  });

  it("hands an IME-confirming key back to xterm", () => {
    expect(xtermImeKeyVerdict(enter({ isComposing: true }))).toBe(true);
  });

  it("hands back the Safari confirmation that follows compositionend", () => {
    fire("compositionstart");
    fire("compositionend");
    expect(xtermImeKeyVerdict(enter())).toBe(true);
  });

  it("has no verdict when no IME is involved, Meta included", () => {
    expect(xtermImeKeyVerdict(enter())).toBeUndefined();
    expect(xtermImeKeyVerdict(meta(false))).toBeUndefined();
  });
});
