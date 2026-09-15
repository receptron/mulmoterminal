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
//
// GPU CONTEXT LOSS is the third thing this pairing gets wrong, and the only one with no error to
// read (#2076). When Chrome restarts its GPU process the browser blanks every 2D canvas and fires
// `contextlost` / `contextrestored` — and NEITHER the addon nor xterm 6 listens for either. Grep
// both bundles: zero occurrences. The glyph cache is the part that does not survive: the addon
// keeps glyph -> atlas position in a `FourKeyMap` and blits from 512px atlas pages, so after the
// restore the map still says every glyph is rasterized while the pages are empty. Backgrounds are
// `fillRect`s and keep drawing; text goes invisible and stays that way until the page is reloaded.
// A glyph the cache has NOT seen is rasterized fresh, which is why only characters typed after the
// restore appear — the symptom the report opens with.

/** Just the part of a terminal / addon this file needs. Structural so a spec can drive it with
 *  fakes — the real pairing needs a canvas, which jsdom does not have. */
export interface Disposes {
  dispose(): void;
}

/** Dispose without letting the failure travel: everything here is called by someone with cleanup
 *  still to do. */
function disposeQuietly(target: Disposes | null, whatFailed: string): void {
  try {
    target?.dispose();
  } catch (err) {
    console.warn(`[terminal] ${whatFailed}`, err);
  }
}

// ── rebuilding the glyph atlas when the GPU comes back (#2076) ────────────────────────────────

/** The part of a terminal the atlas recovery needs. Structural, like `Disposes` above, so a spec
 *  can drive it without a canvas. */
export interface ClearsTextureAtlas {
  clearTextureAtlas(): void;
}

// Every terminal currently holding a canvas renderer, keyed by IDENTITY. A map rather than a set,
// and the key type is the reason: `disposeTerminal` knows its terminal only as a `Disposes`, and
// removing it from a `Set<ClearsTextureAtlas>` would need a cast asserting something the type does
// not say. Keyed by `object`, the untrack is honest — identity is all it needs — and the value
// carries the method the rebuild calls.
//
// The only thing that removes an entry is `disposeTerminal`, which is also the only way a terminal
// in this app goes away (useTerminalConnections.ts calls it on both paths). A terminal dropped some
// other way would be retained here — so if a third teardown path is ever added, it belongs in
// `disposeTerminal` rather than beside it.
const atlasOwners = new Map<object, ClearsTextureAtlas>();
let restoreListening = false;
let clearPending = false;

function clearEveryAtlas(): void {
  clearPending = false;
  for (const term of atlasOwners.values()) {
    // One cell's renderer refusing must not cost the others theirs — this is a recovery path, and
    // the alternative to a warning is a grid where some cells came back and the rest did not.
    try {
      term.clearTextureAtlas();
    } catch (err) {
      console.warn("[terminal] could not rebuild the glyph atlas after the GPU came back", err);
    }
  }
}

/** One restore, one rebuild. A single GPU restart fires `contextrestored` once per canvas — a text
 *  layer per terminal, and more besides — and each rebuild is a full refresh of every cell.
 *
 *  A microtask rather than `requestAnimationFrame`: rAF does not run in a background tab, so the
 *  tab you are not looking at would stay blank until you looked at it, which is the moment the
 *  repair is least welcome. */
function onCanvasRestored(): void {
  if (clearPending) return;
  clearPending = true;
  queueMicrotask(clearEveryAtlas);
}

/** Watch for the GPU coming back, on behalf of `term`.
 *
 *  ON `document`, AT THE CAPTURE PHASE, and both halves are load-bearing:
 *
 *  - `contextlost` / `contextrestored` do NOT bubble, so a listener on an ancestor only ever sees
 *    them on the way DOWN. Capture reaches every target in the document regardless.
 *  - the canvas that fires the one we catch is the terminal's TEXT LAYER, which xterm puts in the
 *    document. The atlas pages are 512px canvases the addon keeps to itself and never attaches, so
 *    nothing of theirs reaches a document listener. If a future xterm stops putting the text layer
 *    in the DOM, this hook goes quiet with no error — which is the thing to re-measure on a bump.
 *
 *  EVERY tracked terminal is cleared, not the one whose canvas fired. Two reasons, and the second
 *  is why this must not be "optimised" to clear one: terminals with the same font size and dpr
 *  SHARE an atlas (`acquireTextureAtlas` keys the cache on them), so clearing one clears theirs —
 *  but a cell with a different font size has its own, and a terminal parked off-screen fires
 *  nothing at all while still holding a stale cache. */
export function trackTextureAtlas(term: ClearsTextureAtlas): void {
  atlasOwners.set(term, term);
  if (restoreListening) return;
  document.addEventListener("contextrestored", onCanvasRestored, true);
  restoreListening = true;
}

/** Stop watching on behalf of `term`. Exported for the spec; the app reaches it through
 *  `disposeTerminal`. */
export function untrackTextureAtlas(term: object): void {
  atlasOwners.delete(term);
}

/** Load a renderer addon onto a terminal, and clean up after a load that fails HALFWAY.
 *
 *  `loadAddon` registers the addon before it activates it
 *  (`@xterm/xterm/src/common/public/AddonManager.ts:29-31`), so a throw out of `activate()` leaves
 *  it in xterm's addon list — where the terminal's own dispose would reach it at exactly the moment
 *  this file exists to avoid. Disposing it here happens while the terminal is still whole, which is
 *  the safe side of that rule (CodeRabbit, PR #2026).
 *
 *  Generic and structural so a spec can fail the load on purpose. */
export function attachRenderer<T extends Disposes>(term: { loadAddon: (addon: T) => void }, renderer: T): T | null {
  try {
    term.loadAddon(renderer);
    return renderer;
  } catch (err) {
    console.warn("[terminal] canvas renderer unavailable — falling back to the DOM renderer", err);
    disposeQuietly(renderer, "the half-loaded canvas renderer would not let go either");
    return null;
  }
}

/** The canvas renderer, or null where it could not initialise — xterm keeps its own DOM renderer
 *  then, and there is nothing of ours to dispose first. */
export function loadCanvasRenderer(term: Terminal): CanvasAddon | null {
  try {
    const renderer = attachRenderer(term, new CanvasAddon());
    // Only a terminal that really has the canvas renderer: the DOM renderer draws no atlas, and
    // `clearTextureAtlas()` on it is a call with nothing behind it.
    if (renderer) trackTextureAtlas(term);
    return renderer;
  } catch (err) {
    console.warn("[terminal] canvas renderer could not be constructed — using the DOM renderer", err);
    return null;
  }
}

/** Dispose a terminal and its renderer addon, renderer FIRST, and never throw at the caller. */
export function disposeTerminal(term: Disposes, renderer: Disposes | null): void {
  // FIRST, and before either dispose can throw: a terminal left in the set outlives its renderer,
  // and the next GPU restore would call `clearTextureAtlas()` on a disposed one.
  untrackTextureAtlas(term);
  disposeQuietly(renderer, "the canvas renderer would not let go — disposing the terminal anyway");
  disposeQuietly(term, "dispose threw; the slot is being torn down regardless");
}
