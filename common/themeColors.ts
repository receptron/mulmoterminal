// The xterm ITheme keys a `.mulmoterminal.json` `colors` block may override. Shared across
// the build boundary: the server config schema validates/strips a config against this set,
// and the client dir-config parser re-checks the server-sanitized response against the same
// set. Kept in common/ so the two can't drift — a key in one list but not the other would be
// silently accepted on one side and dropped on the other.
export const THEME_COLOR_KEYS = [
  "foreground",
  "background",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

/** What a palette colour may look like: xterm accepts `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`.
 *  Here rather than in the server schema because BOTH sides check it — the server rejects a config
 *  on it, and the client re-checks the response before the value reaches a canvas. Two copies of
 *  this pattern is how one side ends up accepting what the other drops. */
export const PALETTE_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** STRICT — surrounding whitespace is a reject, not something to trim away. The server's
 *  `paletteColor` trims before it matches and hands back the trimmed value, so everything this
 *  predicate legitimately sees has already been normalised; accepting `" #fff "` here would mean
 *  forwarding that exact string to xterm, which does not trim and cannot parse it. Validate the
 *  value you are about to pass on, not a cleaned-up version of it. */
export function isPaletteColor(value: unknown): value is string {
  return typeof value === "string" && PALETTE_COLOR_RE.test(value);
}
