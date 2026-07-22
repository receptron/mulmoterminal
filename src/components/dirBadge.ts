import { readableTextColor } from "./contrast";

// Inline style for a directory's name badge: the configured color as the
// background, with black or white text picked for contrast. Shared by the single
// view (Terminal header) and the grid (cell header) so the badge looks the same in
// both. A null/missing color falls back to a neutral panel chip.

// Text colour is whichever of black/white WCAG says is more readable on the badge — see
// contrast.ts for why the old brightness approximation was not good enough.
function textColorFor(hex: string): "#000" | "#fff" {
  const n = parseInt(hex.slice(1), 16);
  return readableTextColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function badgeStyleFor(color: string | null | undefined): Record<string, string> {
  if (!color || !HEX_COLOR_RE.test(color)) {
    return { background: "var(--bg-elevated)", color: "var(--text-secondary)" };
  }
  return { background: color, color: textColorFor(color) };
}
