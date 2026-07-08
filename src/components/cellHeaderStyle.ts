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

// Inline CSS custom properties for the cell frame + accents, set on the cell root so
// descendants inherit them: body background, border, the idle status dot, and the
// header's icon buttons. Like the header vars, the status frame/dot still override
// their targets while working/blocked so activity feedback is preserved.
export function cellStyleFor(
  background: string | null | undefined,
  border: string | null | undefined,
  dot: string | null | undefined,
  button: string | null | undefined,
): Record<string, string> {
  const style: Record<string, string> = {};
  if (isHex(background)) style["--cell-bg"] = background;
  if (isHex(border)) style["--cell-border"] = border;
  if (isHex(dot)) style["--cell-dot"] = dot;
  if (isHex(button)) style["--cell-btn"] = button;
  return style;
}

// The Terminal component's own header row (the grid cell's row 2 and the single view's
// header) reuses the same header colors + button color, via the same CSS vars, so both
// header rows match. Emitted on that header element.
export function terminalHeaderStyleFor(
  background: string | null | undefined,
  text: string | null | undefined,
  button: string | null | undefined,
): Record<string, string> {
  const style = headerStyleFor(background, text);
  if (isHex(button)) style["--cell-btn"] = button;
  return style;
}
