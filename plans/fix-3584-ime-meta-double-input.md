# fix: a bare Cmd during an IME composition sends the text twice (#3584)

## Cause

xterm 6.0.0 `CompositionHelper.keydown` commits the in-progress composition for any keydown whose
keyCode is not 20/229/16/17/18. Meta (91/93) is missing, so a Cmd keydown while composing sends the
text, and `compositionend` sends it again. Upstream: xtermjs/xterm.js#6244 (open, not in any release).

Typical trigger: Karabiner's "Cmd alone sends 英数/かな" rule, which emits Cmd down/up before 英数.

## Fix

- `src/composables/composingMeta.ts` — pure `isMetaDuringComposition(event)`: keydown, `isComposing`,
  `key === "Meta"`.
- `imeComposition.ts` — `xtermImeKeyVerdict(event)`: `false` for that key, `true` for an IME confirmation
  (the old `isImeConfirming` branch), `undefined` otherwise. The terminal handler asks it first.
  xterm calls the custom handler before `CompositionHelper.keydown`, and `false` returns before it;
  no `preventDefault`, so the IME still receives the key.
- The Meta check comes BEFORE `isImeConfirming`, which is `true` (hand back to xterm) for any composing
  key and so would let the Meta reach the helper.

## Scope

- Only the bare Meta keydown. Cmd+<letter> during a composition still commits, as xterm intends.
- Only the terminal cell handler: other inputs are native fields, which do not have this bug.
- Remove once an xterm release fixes the modifier list.

## Verification

- Unit spec for the predicate; handler spec that the Meta keydown is withheld (fails with the guard
  line removed).
- One-off run against the real `@xterm/xterm` in jsdom: composition then Meta then compositionend
  sends the text twice without the guard and once with it; without Meta it sends once either way.
- Not exercised: a real macOS IME keypress in a browser.

## Why a verdict helper rather than a second `if`

`useTerminalConnections.ts` sits at the `max-lines` limit; asking one helper for both IME decisions
keeps the handler at one call and puts the IME ordering in the IME module.
