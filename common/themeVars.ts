// A custom theme's colours, and the rules that turn a user's `themes` entry into something the
// app can paint with. Shared across the build boundary for the same reason THEME_COLOR_KEYS is
// (see themeColors.ts): the server VALIDATES a config against these keys and the client APPLIES
// it, so a key known to one side and not the other would be accepted and then silently ignored.

import { THEME_IDS, type ThemeId } from "./themeIds.js";
import type { ThemeColorKey } from "./themeColors.js";

// The CSS custom properties one theme sets, mirroring the `:root[data-theme=...]` blocks in
// src/style.css. A theme with no `extends` has to supply every one of them — a half-painted
// theme is worse than none, because the missing half falls back to whatever the previous theme
// left on the element.
export const THEME_VAR_KEYS = [
  "--bg-base",
  "--bg-deep",
  "--bg-panel",
  "--bg-subtle",
  "--bg-elevated",
  "--bg-input",
  "--bg-hover",
  "--bg-selected",
  "--bg-selected-hover",
  "--border",
  "--accent",
  "--accent-bg",
  "--accent-bg-hover",
  "--on-accent",
  "--text",
  "--text-secondary",
  "--text-muted",
  "--text-dim",
  "--term-fg",
  "--term-selection",
] as const;

export type ThemeVarKey = (typeof THEME_VAR_KEYS)[number];
export type ThemeVars = Record<ThemeVarKey, string>;

/** An id a user may give a custom theme: lowercase, digits and dashes, so it is safe both as a
 *  `data-theme` attribute value and as something to type into a `.mulmoterminal.json`. */
export const CUSTOM_THEME_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Whether a value could name a theme — built-in OR user-defined.
 *
 *  The result is `string`, deliberately NOT `ThemeId`: that is the CLOSED set of four built-ins,
 *  and a guard claiming it while custom ids flow through would let downstream code treat a
 *  four-way switch as exhaustive (Codex review on #996). Membership is not checked here — the
 *  server drops an id that resolves to nothing, and termThemeFor() resolves what survives. */
export function isThemeIdLike(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_THEME_ID_RE.test(value);
}

export function isBuiltinThemeId(id: string): id is ThemeId {
  return THEME_IDS.some((builtin) => builtin === id);
}

/** Whether an id may be used for a CUSTOM theme. Built-in ids are refused rather than merged
 *  into: someone reading the guide's description of Midnight has to get Midnight. */
export function isUsableCustomThemeId(id: unknown): id is string {
  return typeof id === "string" && CUSTOM_THEME_ID_RE.test(id) && !isBuiltinThemeId(id);
}

export interface CustomThemeInput {
  id: string;
  label: string;
  /** A built-in theme to start from. Omitted means `colors` must be complete. */
  extends?: ThemeId;
  colors: Partial<ThemeVars>;
  /** xterm palette entries set outright, for the canvas colours `colors` cannot reach: the
   *  cursor pair, the selection foreground, the 16 ANSI colours. Wins over what `colors`
   *  implies (#2097). */
  term?: Partial<Record<ThemeColorKey, string>>;
}

/** The full variable set for a theme: the base it extends, with its own colours on top.
 *  `builtins` supplies the base sets so this stays pure — the client reads them from the
 *  stylesheet's source of truth, the specs from a fixture. PARTIAL because a base can genuinely be
 *  missing (a stylesheet read that found no block for that id), and the `?? {}` below has always
 *  handled that — the map only ever needed one key, never all of them. */
// Every variable present, which is what separates a set we can paint with from one we cannot.
// A guard rather than a length check on the missing keys: both ask the same question, but only
// this one hands the answer to the compiler.
function isCompleteThemeVars(vars: Partial<ThemeVars>): vars is ThemeVars {
  return THEME_VAR_KEYS.every((key) => !!vars[key]);
}

export function resolveThemeVars(theme: CustomThemeInput, builtins: Partial<Record<ThemeId, ThemeVars>>): ThemeVars | null {
  const base = theme.extends ? builtins[theme.extends] : null;
  const merged: Partial<ThemeVars> = { ...(base ?? {}), ...theme.colors };
  // No base and an incomplete list is the one case we cannot paint: report it rather than
  // leaving the gaps to whatever the previously applied theme put on the element.
  return isCompleteThemeVars(merged) ? merged : null;
}

function channel(hex: string, at: number): number {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` as `#rrggbb`, or null. The config schema accepts
 *  every one of those forms, so anything reading a colour has to expand the short ones — a
 *  luminance check that understood only the six-digit form would read `#fff` as unmeasurable and
 *  call a white theme dark (Codex review on #996).
 *
 *  Alpha is dropped rather than composited: what a translucent `--bg-base` ends up looking like
 *  depends on what is behind it, which nothing here can know. The opaque colour is the closest
 *  honest answer, and `--bg-base` is the one variable where translucency makes least sense. */
export function normalizeHexColor(color: string): string | null {
  const hex = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{3,8}$/.test(hex)) return null;
  const digits = hex.slice(1);
  if (digits.length === 3 || digits.length === 4) {
    return `#${[...digits.slice(0, 3)].map((d) => d + d).join("")}`;
  }
  if (digits.length === 6 || digits.length === 8) return `#${digits.slice(0, 6)}`;
  return null;
}

/** Relative luminance (WCAG) of any hex colour the config accepts. Null for anything else. */
export function relativeLuminance(color: string): number | null {
  const hex = normalizeHexColor(color);
  if (!hex) return null;
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

// Above this, the chrome is treated as a light theme. The status pills (ok / warn / err) come in
// a dark-background set and a light-background set, and picking the wrong one leaves them
// unreadable — which is why this is derived rather than declared: a theme author who never
// thinks about it still gets legible pills.
const LIGHT_LUMINANCE_THRESHOLD = 0.4;

export function isLightTheme(vars: ThemeVars): boolean {
  const luminance = relativeLuminance(vars["--bg-base"]);
  return luminance !== null && luminance > LIGHT_LUMINANCE_THRESHOLD;
}

/** The xterm palette a theme's variables imply. xterm draws on a canvas and cannot read CSS
 *  variables, so the same colours have to reach it as values — derived here rather than asked
 *  for twice, since two copies of one colour is two chances to change only one. The 16 ANSI
 *  colours are NOT derived: they come from the base theme, which is what `extends` is for.
 *
 *  The cursor pair is derived from the SAME two variables the cell it sits on uses, which makes
 *  the cursor an inverted cell — so the character under it stays as readable as the characters
 *  beside it. Inheriting the cursor from the base instead is what made a light theme extending a
 *  dark one draw a dark block with xterm's default black glyph on top (#2097). */
export function termThemeFromVars(vars: ThemeVars): {
  background: string;
  foreground: string;
  selectionBackground: string;
  cursor: string;
  cursorAccent: string;
} {
  return {
    background: vars["--bg-base"],
    foreground: vars["--term-fg"],
    selectionBackground: vars["--term-selection"],
    cursor: vars["--term-fg"],
    cursorAccent: vars["--bg-base"],
  };
}
