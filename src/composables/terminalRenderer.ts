import { CanvasAddon } from "@xterm/addon-canvas";
import type { Terminal } from "@xterm/xterm";

// The canvas renderer's whole lifecycle: how a terminal gets one, and the order the two have to be
// taken apart in.
//
// WHY CANVAS AT ALL — it renders each glyph in its own cell, instead of the DOM renderer's inline
// runs: a full-width CJK glyph that isn't exactly 2x the Latin cell lets a long Japanese line drift
// right and spill its tail past the terminal's edge (the reason this was added, b12cc48). A
// fixed-grid renderer makes that structurally impossible.
//
// CAVEAT — version mismatch: @xterm/addon-canvas is xterm-5 era (its peerDependency is
// `@xterm/xterm@^5`, and there is no xterm-6 build — even 0.8.0-beta still peers ^5), but the app
// runs @xterm/xterm@6. It renders, and it was once named the suspected cause of #782 (selection
// auto-scroll + scrollbar) and #783 (OSC 8 links); measurement disproved both. What the mismatch
// DOES mean is that a future xterm bump cannot be repaired by bumping this addon, because no such
// release exists — see the Renderer section of docs/terminal-notes.md for what to move to on the
// day it breaks, and what to settle before moving.
//
// DISPOSAL ORDER is the other thing the pairing gets wrong (#2021). On dispose the addon restores
// the DOM renderer by calling the core's `_createRenderer()`, and xterm 6 builds that renderer out
// of `this.linkifier` — a `MutableDisposable` the terminal's own dispose has already cleared by the
// time it reaches its addons. The DOM renderer then subscribes to `undefined`:
//
//     TypeError: Cannot read properties of undefined (reading 'onShowLinkUnderline')
//
// Measured in a real browser against the versions this app ships: disposing the terminal with the
// addon still loaded throws EVERY time; disposing the addon first, while the terminal is still
// whole, never does. So the order is the fix, and the try/catch is for what neither of us can see
// coming.
//
// It matters beyond a console line, because the throw escapes `dispose()` and whatever the caller
// meant to do next does not run. In the #846 rebuild path that is `connect()` — the repair for a
// frozen cell would leave the replacement terminal attached to no socket at all.

/** The canvas renderer, or null where it could not initialise — xterm keeps its own DOM renderer
 *  then, and there is nothing of ours to dispose first. */
export function loadCanvasRenderer(term: Terminal): CanvasAddon | null {
  try {
    const canvas = new CanvasAddon();
    term.loadAddon(canvas);
    return canvas;
  } catch (err) {
    console.warn("[terminal] canvas renderer unavailable — falling back to the DOM renderer", err);
    return null;
  }
}

/** Just the part of a terminal / addon the teardown needs. Structural so a spec can drive it with
 *  fakes — the real pairing needs a canvas, which jsdom does not have. */
export interface Disposes {
  dispose(): void;
}

/** Dispose a terminal and its renderer addon, renderer FIRST, and never throw at the caller. */
export function disposeTerminal(term: Disposes, renderer: Disposes | null): void {
  try {
    renderer?.dispose();
  } catch (err) {
    console.warn("[terminal] the canvas renderer would not let go — disposing the terminal anyway", err);
  }
  try {
    term.dispose();
  } catch (err) {
    console.warn("[terminal] dispose threw; the slot is being torn down regardless", err);
  }
}
