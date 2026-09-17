// The custom themes from ~/.mulmoterminal/config.json (#996), and the DOM work that paints one.
//
// A built-in theme needs no painting: style.css already holds a `:root[data-theme=<id>]` block,
// so setting the attribute is the whole job. A custom theme has no such block — its variables
// are written onto the root element here, and removed again when the user leaves it, so nothing
// of one theme survives into the next.

import { ref, computed } from "vue";
import { THEME_VAR_KEYS, resolveThemeVars, isLightTheme, termThemeFromVars, type CustomThemeInput, type ThemeVars } from "../../common/themeVars";
import { THEME_COLOR_KEYS, isPaletteColor, type ThemeColorKey } from "../../common/themeColors";
import type { ThemeId } from "../../common/themeIds";
import { isRecord } from "../../common/isRecord";

// The built-in palettes, read from the stylesheet rather than restated here — style.css is the
// source of truth for what Midnight is, and a second copy would drift the moment one is edited.
//
// Read from the RULE, not from a probe element's computed style. The blocks are written
// `:root[data-theme="x"]`, which only ever matches the document element: a detached or nested
// probe carrying the attribute matches nothing and inherits the variables of the theme currently
// applied — so every id would answer with the active theme's colours, and `extends` would
// silently mean "extends whatever is on screen".
function ruleVars(id: ThemeId, sheets: readonly CSSStyleSheet[]): ThemeVars | null {
  const wanted = `:root[data-theme="${id}"]`;
  // A selector LIST, not the whole selectorText: the default theme's block is written
  // `:root, :root[data-theme="midnight"]` so an unset document still gets a palette, and an
  // equality test against the whole string finds every theme except that one.
  const matches = (rule: CSSStyleRule) =>
    rule.selectorText
      .split(",")
      .map((selector) => selector.trim())
      .includes(wanted);
  const found: Partial<ThemeVars> = {};
  for (const sheet of sheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules; // a cross-origin sheet throws here; ours are bundled, but be safe
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !matches(rule)) continue;
      THEME_VAR_KEYS.forEach((key) => {
        const value = rule.style.getPropertyValue(key).trim();
        if (value) found[key] = value;
      });
    }
  }
  return isCompleteVars(found) ? found : null;
}

// Every variable present — a guard so the check narrows instead of being restated as a cast.
const isCompleteVars = (vars: Partial<ThemeVars>): vars is ThemeVars => THEME_VAR_KEYS.every((key) => !!vars[key]);

export function readBuiltinVars(id: ThemeId, doc: Document = document): ThemeVars | null {
  return ruleVars(
    id,
    Array.from(doc.styleSheets).filter((sheet): sheet is CSSStyleSheet => sheet instanceof CSSStyleSheet),
  );
}

const customThemes = ref<CustomThemeInput[]>([]);

/** Hydrated from /api/config on boot and on every config change. */
export function setCustomThemes(input: unknown): void {
  customThemes.value = Array.isArray(input) ? input.filter(isCustomThemeInput) : [];
}

function isCustomThemeInput(value: unknown): value is CustomThemeInput {
  if (!isRecord(value)) return false;
  const theme = value;
  return typeof theme.id === "string" && typeof theme.label === "string" && typeof theme.colors === "object" && theme.colors !== null;
}

export const customThemeList = computed(() => customThemes.value);

export function findCustomTheme(id: string): CustomThemeInput | null {
  return customThemes.value.find((theme) => theme.id === id) ?? null;
}

/** Paint a custom theme: its variables onto the root element, and the light/dark flag the
 *  status-pill rules key on. Returns false when the theme cannot be completed — the caller
 *  falls back to a built-in rather than leaving a half-painted element. */
export function applyCustomTheme(
  theme: CustomThemeInput,
  builtins: Partial<Record<ThemeId, ThemeVars>>,
  root: HTMLElement = document.documentElement,
): boolean {
  const vars = resolveThemeVars(theme, builtins);
  if (!vars) return false;
  THEME_VAR_KEYS.forEach((key) => root.style.setProperty(key, vars[key]));
  root.setAttribute("data-appearance", isLightTheme(vars) ? "light" : "dark");
  return true;
}

/** Undo applyCustomTheme, so switching back to a built-in doesn't leave overrides winning over
 *  the stylesheet's own block (an inline property beats any selector). */
export function clearCustomTheme(root: HTMLElement = document.documentElement): void {
  THEME_VAR_KEYS.forEach((key) => root.style.removeProperty(key));
}

/** The palette entries a theme sets outright, keyed down to the ones xterm knows and checked
 *  against the colour shape. Re-checked here even though the server already validated: same
 *  reason the dir-config parser re-checks its own `colors` block — the lists are one set in
 *  common/, and a key that only one side knew would be accepted at the boundary and dropped on
 *  the way to the canvas. The VALUE is re-checked too, because a string that is not a colour
 *  does not fall back to the theme's: xterm throws while parsing it, and the throw happens
 *  during `term.options.theme = …`, which takes the whole terminal down rather than one colour. */
function themeTermOverrides(theme: CustomThemeInput): Partial<Record<ThemeColorKey, string>> {
  const raw = theme.term;
  if (!isRecord(raw)) return {};
  const out: Partial<Record<ThemeColorKey, string>> = {};
  for (const key of THEME_COLOR_KEYS) {
    const value = raw[key];
    if (isPaletteColor(value)) out[key] = value;
  }
  return out;
}

/** The xterm palette for a custom theme, or null when it can't be resolved. The theme's own
 *  `term` block wins over what its CSS variables imply — it is the more specific statement. */
export function customTermTheme(theme: CustomThemeInput, builtins: Partial<Record<ThemeId, ThemeVars>>) {
  const vars = resolveThemeVars(theme, builtins);
  return vars ? { ...termThemeFromVars(vars), ...themeTermOverrides(theme) } : null;
}
