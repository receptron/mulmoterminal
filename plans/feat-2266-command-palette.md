# feat: command palette (#2266)

## Problem
With no default `keymap`, the only way to a grid action for someone who has not written one was
the mouse, and nothing listed which keys a user had bound, or which actions exist.

## Decisions (asked of the maintainer)
- **How it opens: a toolbar button plus a new `command-palette` keymap action with NO default.**
  The "no default bindings" policy stands. VS Code's `Cmd+Shift+P` is suggested in the docs, not
  bound.
- Look: the file finder's (top-centre panel, input plus list).
- Actions that cannot run in the current view stay in the list, greyed out with the reason.
- Scope: `KEYMAP_ACTIONS`, minus `copy` / `paste` (decided inside the terminal) and the palette
  itself.
- Each row has a one-line description, in every locale.

## Design
- `src/composables/commandPaletteRows.ts` (pure) builds the rows: it ranks `label + " " + id` with
  the file finder's matcher (`rankPaths`), so typing the config id (`find`) works; it highlights in
  the label only; it shows the user's binding as written; and it gives the disabled reason from
  `NEEDS_A_CURRENT_TERMINAL` / `NEEDS_NOTHING_ENLARGED`.
- `src/composables/commandPalette.ts`: `paletteOpen` and `paletteHost`, module-level, because the
  toolbar opens it, the palette picks and only the grid can run an action.
- `src/composables/useGridKeys.ts` wraps `usePrefixKeys`. It turns `command-palette` into
  "open the palette", runs everything else through `gateShortcut` (the same gate a key goes
  through), and registers itself as the palette's host while mounted. `GridView.vue` uses it in
  place of `usePrefixKeys`; the file stays at its line limit.
- `CommandPalette.vue` is teleported to body with `font-sans`. Arrows move, Enter runs (a disabled
  row keeps the palette open), and Esc or a click on the backdrop closes it.
- Not extracted: `FileFinder.vue`'s template. Only its pure matcher is shared, so the finder is
  untouched and there is no refactor to prove.
- Docs: `config.md` actions table (en/ja) and the `mulmoterminal-keys` skill, whose advice to put
  VS Code's palette key on `files-find` now points at `command-palette`.

## Spec
- `test/src/composables/commandPaletteRows.spec.ts`
- `test/src/components/CommandPalette.spec.ts`
- `test/src/composables/useGridKeys.spec.ts`
- `test/src/components/AppToolbar.spec.ts` (the button)

Six decisions were removed one at a time, and each turned a spec red.
