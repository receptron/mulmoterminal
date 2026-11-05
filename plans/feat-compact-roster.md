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

- `common/cockpitLines.ts`: `CockpitLines` gains `compact: boolean`, default `false`. Sanitized
  per field like the rest: only literal `true` turns it on, anything else is the default.
- Roster row (`TerminalGrid.vue`): when `cockpitLines.compact`, the header stays and the four lines
  give way to ONE line — the session's name, from `sessionDisplayName` (memo, then summary, then
  prompt, then the fallback label). That is the same precedence the cell header uses, so a row and
  its cell go by the same name. One line, truncated, with the whole text on hover.
- The pure rule (`rosterTitle`) lives in `src/components/rosterRow.ts`.
- Settings → Waiting rows: a checkbox. While it is on, the three steppers are disabled — they
  have nothing to clamp.
- Docs: `docs/guide/{en,ja}/config.md`, the `mulmoterminal-config` skill section, i18n (all locales).

## Decision

Global (in config.json, next to the line counts) rather than per browser like the blink: it is the
same trade the line counts make, and it rides on their existing load / save / sanitize path.

## Tests

- `sanitizeCockpitLines`: `compact` default false, `true` kept, non-boolean ignored, counts untouched.
- `rosterTitle`: memo wins, then summary, prompt, fallback; empty strings skipped.
- `TerminalGrid` spec: compact shows the header and one title line and no `cockpit-line` / memo.
