# feat(files): the Markdown preview follows the app's theme (#2263)

## Problem
The preview document's colours followed the OS `prefers-color-scheme` only, and the iframe was
`bg-white`. With a dark app theme and a light OS, the pane showed a white box.

Reproduced in Chrome with Midnight and the OS set to light: the preview body was
`rgb(255, 255, 255)`.

## Fix
- `common/previewTheme.ts`, shared by both ends:
  - query names mapped to app theme variables — `bg` `--bg-base`, `fg` `--text`, `muted`
    `--text-secondary`, `subtle` `--bg-subtle`, `border` `--border`, `link` `--accent`;
  - `previewThemeFromVars` and `previewThemeFromQuery` build a theme only when EVERY value is a hex
    colour (`isPaletteColor`). Any other value drops the whole theme, because the values land in
    CSS and a partial theme could put dark text on a dark background.
- Host: `useTheme` exports `activeThemeVars`, the theme actually painted (the same fallback as
  `applyTheme`; reactive on the selection and on custom themes arriving). `useOpenFile` puts it on
  `previewSrc` via `previewQuery`, so a theme change is a new src and a refetch. The reader's place
  is restored by the #2157 reporter. The iframe background is `bg-[var(--bg-base)]`.
- Server: only the embed document (`?embed=1`, the pane) reads the theme. `themeStyle` appends rules
  after the system-theme ones, so they win. `color-scheme` comes from the background through
  `isLightColor`, the line `isLightTheme` already drew. The plain document (the new tab a clicked
  `.md` opens) has no host to ask and keeps following the system theme.

Not done: contrast correction. A custom theme whose accent is too faint against its background
gets a faint link here too.

## Spec
- `test/common/previewTheme.spec.ts`: every colour read; other hex spellings accepted; the whole
  theme dropped for CSS that closes the rule, a named colour, `rgb()`, `url()`, whitespace, a
  repeated parameter, or a missing value; `fromVars` maps each variable
- `test/server/files/renderedDoc.spec.ts`: rules, `color-scheme` from the background, placed after
  the system-theme rules
- `test/src/components/filesPreviewSrc.spec.ts`: colours on the query, a theme change changes the src
- `test/server/files/files-browse.spec.ts`: the embed document is painted; an injection attempt is
  ignored; the plain document is untouched

Each of the four decisions was removed in turn, and the spec went red. The pane's wiring
(`activeThemeVars` → `previewSrc`) cannot be exercised in jsdom, which loads no stylesheet; it was
checked in Chrome: Midnight + light OS gives `#1a1a2e`, Daylight + dark OS gives `#f4f6fb`.
