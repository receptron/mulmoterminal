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
