# fix: rebuild the glyph atlas when Chrome's GPU process comes back

Issue: [#2076](https://github.com/receptron/mulmoterminal/issues/2076) — reported with a repro, a
pixel measurement and a working diff by [@naoixion](https://github.com/naoixion).

## The claim, and what was verified before taking it

The report says a Chrome GPU-process restart leaves a terminal cell's text invisible until the page
is reloaded, because `@xterm/addon-canvas`'s texture atlas is emptied on the GPU side and never
rebuilt. Checked against this checkout rather than taken on trust:

1. **Nothing in the shipped stack reacts to a context restore.** `@xterm/xterm@6.0.0` and
   `@xterm/addon-canvas@0.7.0`: `grep -c "contextlost\|contextrestored"` is **0** in both bundles.
2. **The cache is the part that outlives the pages.** The addon holds glyph → atlas position in a
   `FourKeyMap` over `_textureSize = 512` pages; `clearTextureAtlas()` chains Terminal →
   RenderService → render layers → `_charAtlas.clearTexture()`, which is what drops it.
3. **The repaint is already built in.** The core's
   `clearTextureAtlas(){ this._renderer.value && (this._renderer.value.clearTextureAtlas?.(), this._fullRefresh()) }`
   refreshes, which is why the recovery needs no keystroke — the report's "操作なし" claim.
4. **The symptom's detail matches the mechanism.** Backgrounds are `fillRect`s (they survive),
   glyphs are blits from the atlas (blank), and a glyph the cache has not seen is rasterized fresh —
   which is exactly "only the characters typed after the restart are visible".
5. **It is not fixed since.** `src/composables/terminalRenderer.ts` has no commits between the
   reported 4.21.0 and HEAD, so 4.24.0 has it too.

## What this does

`trackTextureAtlas` / `untrackTextureAtlas` in `terminalRenderer.ts`, one `document` listener at the
capture phase, and a microtask that clears every tracked terminal's atlas once per restore.

Three decisions differ from the diff in the issue, each for a reason worth keeping:

- **The registry is keyed by IDENTITY (`Map<object, …>`), not by the atlas interface.**
  `disposeTerminal` knows its terminal only as a `Disposes`; removing it from a
  `Set<ClearsTextureAtlas>` would need an `as` cast asserting something the type does not say, and
  this repo does not take those.
- **The untrack happens FIRST in `disposeTerminal`**, before either dispose can throw. A terminal
  left in the registry outlives its renderer, and the next restore would call into a disposed one.
- **The comments carry the four facts the fix rests on** — why capture, whose canvas actually fires
  the event, why every terminal and not the one that fired, and why no repaint call is needed.
  Without the second, an xterm bump that stops attaching the text layer turns this into a silent
  no-op; without the third, someone "optimises" it to clear one terminal.

`@xterm/addon-webgl` is NOT a dependency here, so the `onContextLoss` half of the issue's plan is
forward-looking only; `docs/terminal-notes.md` already names it as something to settle before moving.

## Verification

Six tests, and each was proved able to fail by breaking the implementation three ways:

| mutation | what went red |
|---|---|
| listener registered without `capture` | all 5 restore-driven tests (a non-bubbling event never reaches `document`) |
| `disposeTerminal` does not untrack | "leaves a disposed terminal alone" |
| no coalescing | "rebuilds once for a burst of events" |

The file was compared against a pristine copy before each mutation and restored after.

Not reproduced here: the GPU-process kill itself. The report's headless-Chrome pixel counts
(32784 before / 6393 after `refresh()` / 41139 after `clearTextureAtlas()`) are the evidence for the
symptom; everything above is the evidence for the mechanism.
