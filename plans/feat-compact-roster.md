# feat: a compact cockpit roster — header plus one title line (#3270)

## Problem

Each roster row shows its header (status, directory) and then memo / summary / prompt / reply.
`cockpitLines` can only lower each line to 1, so a row stays four lines tall even at 1 / 1 / 1. A
user who reads the roster only to tell sessions apart and see their status wants them shorter.

## Why not "header only"

The header carries the status and the DIRECTORY, not the session's name. Two sessions in one
directory would be indistinguishable. And why not `0` per field: memo is not one of the clamped
lines, and the prompt line always prints (falling back to the launcher label), so 0 / 0 / 0 still
leaves a cell without a memo nameless.

## Change

- `common/cockpitCompact.ts`: a top-level boolean key `cockpitCompact`, default `false`, wired
  like `paletteSearchBox` (`createGlobalFlag`). Not a field of `cockpitLines`: an older version
  keeps an unknown top-level key when it writes config.json but drops an unknown nested field, and
  a separate key also means the switch and the steppers never post over each other.
- Roster row (`TerminalGrid.vue`): when `cockpitCompact`, the header stays and the four lines
  give way to ONE line, `CockpitRow.title`. It is built in `rosterRow()` from the cell header's tiers
  (memo, `/rename` name, AI title, last prompt), so a row and its cell go by the same name; the
  agent-store title the summary line admits is not one of them. Then the fallback label. One line,
  truncated, with the whole text on hover.
- Settings → Waiting rows: a checkbox; a refused save puts it back. While it is on, the three
  steppers are disabled — they have nothing to clamp.
- Docs: README, `docs/guide/{en,ja}/config.md`, the `mulmoterminal-config` skill, i18n (all locales).

## Decision

Global (in config.json, next to the line counts) rather than per browser like the blink: it is the
same trade the line counts make.

## Tests

- `rosterRow().title`: the header's tiers in order, the agent-store title skipped, empty tiers skipped.
- `WaitingRowsSection`: saves `cockpitCompact` alone, a refused save puts the box back, steppers disabled while on.
- `app-config` round-trip and `settings-coverage` carry the new key.
- `TerminalGrid` spec: compact shows the header and one title line and no `cockpit-line` / memo.
