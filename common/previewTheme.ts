// The app's theme, carried to the Markdown preview (#2263). The preview is a sandboxed document the
// app cannot style from outside, so the host hands it the few colours it paints with on the URL and
// the server writes them into the document's own <style>.
//
// In `common/` because both ends decide from it: the pane builds the query, the server reads it.
// Every value lands in CSS, so a colour is accepted only in the one shape the app's theme variables
// use — `#` and hex digits — and any other value drops the WHOLE theme, leaving the document on the
// reader's system colours as before. A partial theme could put dark text on a dark background.
import { isPaletteColor } from "./themeColors.js";
import type { ThemeVarKey, ThemeVars } from "./themeVars.js";

/** Query parameter → the app theme variable it carries. */
export const PREVIEW_THEME_PARAMS = {
  bg: "--bg-base",
  fg: "--text",
  muted: "--text-secondary",
  subtle: "--bg-subtle",
  border: "--border",
  link: "--accent",
} as const satisfies Record<string, ThemeVarKey>;

export type PreviewThemeParam = keyof typeof PREVIEW_THEME_PARAMS;
export type PreviewTheme = Record<PreviewThemeParam, string>;

/** Build a theme from named values, or null unless every one is a hex colour. */
function themeOf(valueFor: (param: PreviewThemeParam) => unknown): PreviewTheme | null {
  const colour = (param: PreviewThemeParam): string | null => {
    const value = valueFor(param);
    return isPaletteColor(value) ? value : null;
  };
  const [bg, fg, muted, subtle, border, link] = [colour("bg"), colour("fg"), colour("muted"), colour("subtle"), colour("border"), colour("link")];
  return bg && fg && muted && subtle && border && link ? { bg, fg, muted, subtle, border, link } : null;
}

/** The preview's colours from the app's theme variables. */
export const previewThemeFromVars = (vars: ThemeVars): PreviewTheme | null => themeOf((param) => vars[PREVIEW_THEME_PARAMS[param]]);

/** The preview's colours from a request's query, or null when any is missing or not a hex colour. */
export const previewThemeFromQuery = (query: Record<string, unknown>): PreviewTheme | null => themeOf((param) => query[param]);
