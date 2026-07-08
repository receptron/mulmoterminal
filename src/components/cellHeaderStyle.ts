// Inline CSS custom properties for a cell header tinted by <cwd>/.mulmoterminal.json
// (`headerColor` = background, `headerTextColor` = text). Emitted as variables — not a
// plain background/color — so the header's status tint (working/blocked) can still
// override the background while idle keeps the custom color, and the dir/prompt text
// pick up --cell-header-fg. A missing / non-hex value is dropped (the theme default
// shows through the var fallback). Shared by the grid cell and the single-view header.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isHex = (c: string | null | undefined): c is string => typeof c === "string" && HEX_COLOR_RE.test(c);

export function headerStyleFor(background: string | null | undefined, text: string | null | undefined): Record<string, string> {
  const style: Record<string, string> = {};
  if (isHex(background)) style["--cell-header-bg"] = background;
  if (isHex(text)) style["--cell-header-fg"] = text;
  return style;
}
