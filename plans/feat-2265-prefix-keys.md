# feat(keymap): two-key sequences (#2265)

## Problem
A `keymap` binding could only be one keystroke. With the browser-reserved keys (Cmd+W / T / N)
and the keys the terminal needs set aside, there are not enough free single keys for actions that
come in numbers, such as the Files pane's.

Found while confirming the problem: `"Cmd+K p"` was ACCEPTED as one keystroke named "K p". The
startup check reported nothing, and the binding never fired.

## Design
- Grammar: keystrokes separated by whitespace, at most two (`MAX_SEQUENCE_STROKES`).
  `parseKeySequence` in `common/keymap.ts`. `parseKeyBinding` now refuses whitespace in a key, so
  `send` and the single-stroke paths reject `"Cmd+K p"` instead of accepting a dead binding.
- `copy`, `paste` and `send` stay single-stroke: they are decided inside the terminal, which
  cannot wait. A sequence for them is a fatal startup error.
- Validation warns when a sequence's first key is also bound on its own (an action, `copy`, `paste`
  or a `send`): it names every such binding in dispatch order and says the sequence may never start,
  without predicting in which states. Twice a narrower sentence was wrong for a combination it did not
  list. It also warns when two actions claim the same sequence (the existing duplicate check, keyed on
  the whole sequence), about uppercase-with-Cmd on either keystroke (#2125), and about a bare `Escape`
  as a second key.
- Dispatch: `src/composables/prefixKeys.ts` is a pure step function (pass / wait / run / cancel /
  ignore); `usePrefixKeys` holds the pending state and its 3-second lapse, and `claim` decides
  single vs sequence:
  - A single binding wins when nothing is pending. This includes `copy` / `paste` / `send` on the
    same key, which the terminal decides after the grid, so the sequence does not start on it.
  - While pending, the next key belongs to the sequence.
  - A lone modifier keeps the wait.
  - `Esc`, or any key that is not a candidate, ends it. A bare `Esc` always cancels, even when a
    sequence names it as its second key; validation warns about such a sequence.
  - Every claimed key is stopped, so none of them reaches the terminal.
  - When the grid yields the keyboard (another view, Settings, the launch panel, a text field, an
    IME confirmation), a pending wait is dropped, so it cannot swallow a key later.
  - The resolved action goes through the same zoom gate as single bindings (`gateShortcut`,
    extracted from `gridShortcutFor`).
- `PrefixKeyHint.vue` shows, bottom-right, the first key and each candidate with its action name
  (the Settings labels), plus "Esc cancels". Strings are in every locale.

## Behaviour preservation
`gateShortcut` is a pure extraction. `gridShortcutFor` was compared against the `origin/main` copy
over every action × binding set × key × modifier combination × zoom × event type × composing. The
only differences were for an event whose key is "K p", which no browser sends.

## Spec
- `test/common/keymapSequence.spec.ts`: parse, validate, sanitize, `sequenceBindings`
- `test/src/composables/prefixKeys.spec.ts`: every step, the lapse, keyup / composing
- `test/src/composables/usePrefixKeys.spec.ts`: timer, claim, gate, single-vs-sequence priority
- `test/src/components/GridView.spec.ts`: the real handler runs a sequence, shows and hides the hint,
  prevents default on the prefix, and cancels on Esc

Eight decisions were removed one at a time, and each turned a spec red.
