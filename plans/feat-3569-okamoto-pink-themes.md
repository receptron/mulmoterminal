# feat: built-in themes Okamoto Taro and Pink (#3569)

## What

Two built-in themes beside Midnight / Nord / Daylight / Solarized Light.

| id | label | kind | idea |
|---|---|---|---|
| `okamoto` | Okamoto Taro | dark | near-black ground, vermilion accent, strong primary ANSI colours (red / yellow / blue) |
| `pink` | Pink | light | pale pink ground, white panels, deep rose accent |

## Where

- `common/themeIds.ts` — append the ids (order = picker order; the spec pins `THEMES` to it).
- `src/composables/useTheme.ts` — `THEMES` entries: swatch + full xterm palette (16 ANSI too, so
  colour output stays legible), `cursorAccent` = background, `cursor` = foreground.
- `src/style.css` — one `:root[data-theme="…"]` block each with all 20 tokens. Light/dark status
  pills follow `data-appearance`, computed from `--bg-base`, so nothing else enumerates ids.
- Docs and skills that list the built-in ids.

## Contrast (WCAG, checked with a script)

- `--text` on base / panel: well above 4.5:1 in both.
- `--text-muted` on base / panel: above 4.5:1.
- `--on-accent` on `--accent-bg`: above 4.5:1.
- `--accent` on base / panel: above 4.5:1.
