# feat: link `\`-separated and drive paths in a Windows cell (#3236)

## Problem

`findFilePathLinks` (`src/composables/terminalFilePathLinks.ts`) skipped any token without `/`, and
split at every `:`. So `.claude\evidence\test.md` and `C:\work\a.ts` never became links, and neither
did `D:/w/b.ts`: the drive was cut off, and the rest was skipped as "preceded by `:`".

## Fix

- `findFilePathLinks(line, { windowsPaths })`: `\` separates too, a one-letter drive followed by
  `\` or `/` stays on the token, and a leading `\\` (a UNC share) is not linked. The link's range is
  what was printed; its `text` is the `/`-separated form, so the pane, the routes and
  `pathWithinCwd` keep comparing the shape they already do.
- The provider turns it on when the cell's cwd is a Windows path (`isWindowsRoot`). Off elsewhere,
  because on macOS and Linux `\` is an ordinary file-name character — linking it as a separator
  would open a different file than the one printed.

## Behaviour with the option off

Unchanged: the old `findFilePathLinks` was run beside the new one over generated lines (including
`\`, `\\`, drives, `:`, dots, URLs) with whole results compared and no difference. The specs pin
the off case (`\` stays part of the name, `C:\…` is not linked).

## Left out

- UNC shares (`\\server\share\a.md`): nothing that opens a clicked path addresses one.
