import { ref, computed } from "vue";
import type { ITheme } from "@xterm/xterm";
import { THEME_IDS, type ThemeId } from "../../common/themeIds";
import { applyCustomTheme, clearCustomTheme, customTermTheme, customThemeList, findCustomTheme, readBuiltinVars } from "./customThemes";
import { isLightTheme, isThemeIdLike, resolveThemeVars, type ThemeVars } from "../../common/themeVars";

export type { ThemeId };

export interface Theme {
  // `string`, not ThemeId: the list the picker renders holds the four built-ins AND whatever the
  // user defined in config.json, whose ids no build can enumerate (#996). THEMES below stays
  // narrowed to the built-in ids.
  id: string;
  label: string;
  // Three representative colors shown as the picker swatch.
  swatch: { base: string; panel: string; accent: string };
  // xterm renders on a canvas and can't read CSS variables, so each theme carries
  // an explicit terminal palette mirroring its CSS tokens. Light themes also set
  // the 16 ANSI colors (mapping bright-white to a dark tone) so colored TUI output
  // stays legible on a light background — xterm's defaults assume a dark canvas.
  //
  // `cursorAccent` (the glyph drawn ON the cursor block) is set by every theme for the same
  // reason: xterm's default is a flat `#000000`, which on a light theme is black on a dark
  // block — the one character you are looking at, unreadable (#2097). It is each theme's own
  // background, so the cursor cell reads as an inverted one.
  term: ITheme;
}

export const THEMES: (Theme & { id: ThemeId })[] = [
  {
    id: "midnight",
    label: "Midnight",
    swatch: { base: "#1a1a2e", panel: "#16213e", accent: "#4a8cff" },
    term: { background: "#1a1a2e", foreground: "#e0e0e0", cursor: "#e0e0e0", cursorAccent: "#1a1a2e", selectionBackground: "#3a3a5e" },
  },
  {
    id: "nord",
    label: "Nord",
    swatch: { base: "#2e3440", panel: "#3b4252", accent: "#88c0d0" },
    term: { background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440", selectionBackground: "#434c5e" },
  },
  {
    id: "daylight",
    label: "Daylight",
    swatch: { base: "#f4f6fb", panel: "#ffffff", accent: "#2563eb" },
    term: {
      background: "#f4f6fb",
      foreground: "#1b2430",
      cursor: "#1b2430",
      cursorAccent: "#f4f6fb",
      selectionBackground: "#cfe0ff",
      black: "#1b2430",
      red: "#cf222e",
      green: "#1a7f37",
      yellow: "#9a6700",
      blue: "#2563eb",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#57606a",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#116329",
      brightYellow: "#7d4e00",
      brightBlue: "#1d4ed8",
      brightMagenta: "#6639ba",
      brightCyan: "#3192aa",
      brightWhite: "#1b2430",
    },
  },
  {
    id: "solarized",
    label: "Solarized Light",
    swatch: { base: "#fdf6e3", panel: "#eee8d5", accent: "#268bd2" },
    term: {
      background: "#fdf6e3",
      foreground: "#586e75",
      cursor: "#586e75",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#eee8d5",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#657b83",
      brightBlack: "#073642",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#268bd2",
      brightMagenta: "#6c71c4",
      brightCyan: "#2aa198",
      brightWhite: "#586e75",
    },
  },
];

const STORAGE_KEY = "theme";
const DEFAULT_THEME: ThemeId = "midnight";

// Validate against THEMES, not the id list: an id is only usable if it has a
// theme object here. A THEME_IDS entry with no matching THEMES entry would
// otherwise be accepted, set as data-theme, then silently fall back to THEMES[0]
// for the terminal palette. The useTheme spec asserts the two stay in lockstep.
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some((t) => t.id === value);
}

// A stored selection may name a theme the user defined, which this build cannot enumerate — so
// the id is kept if it LOOKS like one, and whether it resolves is decided when painting. That is
// what lets a selection survive a machine that hasn't got the config yet (#996).

// Set when the selected id names neither a built-in nor a resolvable custom theme. The app paints
// the default and Settings says why — the alternative, which this app shipped until now, is a
// silent fall back to Midnight with nothing on screen to explain it (see the comment above).
export const missingThemeId = ref<string | null>(null);

// Built-in palettes, read once from the stylesheet the first time a custom theme needs a base.
// PARTIAL, honestly: `readBuiltinVars` returns null when the stylesheet has no block for an id,
// so a key can be absent — which the assertion this replaces claimed could not happen. Every
// consumer looks up ONE key and already handles a miss, so nothing needed the stronger promise.
let builtinVars: Partial<Record<ThemeId, ThemeVars>> | null = null;
function builtins(): Partial<Record<ThemeId, ThemeVars>> {
  if (!builtinVars) {
    const vars: Partial<Record<ThemeId, ThemeVars>> = {};
    for (const id of THEME_IDS) {
      const read = readBuiltinVars(id);
      if (read) vars[id] = read;
    }
    builtinVars = vars;
  }
  return builtinVars;
}

// Storage access can throw (private mode / sandboxed contexts with storage
// blocked), so persistence is best-effort: a failure falls back to the default
// rather than crashing app startup.
function loadThemeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeIdLike(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const themeId = ref<string>(loadThemeId());

// A built-in is painted by style.css from the attribute alone; a custom theme has its variables
// written on. Either way `data-appearance` is set, because the status-pill rules key on it.
function applyTheme(id: string) {
  const root = document.documentElement;
  const custom = isThemeId(id) ? null : findCustomTheme(id);
  if (custom && applyCustomTheme(custom, builtins(), root)) {
    root.setAttribute("data-theme", id);
    missingThemeId.value = null;
    return;
  }
  clearCustomTheme(root);
  const fallback = isThemeId(id) ? id : DEFAULT_THEME;
  // Only a selection that named something unavailable is worth reporting; a built-in resolves.
  missingThemeId.value = isThemeId(id) ? null : id;
  root.setAttribute("data-theme", fallback);
  const vars = builtins()[fallback];
  root.setAttribute("data-appearance", vars && isLightTheme(vars) ? "light" : "dark");
}

// The xterm palette for the active theme; Terminal.vue feeds this into the
// terminal's `theme` option and refreshes it whenever the theme changes.
export function currentTermTheme(): Theme["term"] {
  return termThemeFor(themeId.value);
}

// The xterm palette for a specific theme — used by a terminal whose directory pins a
// theme via .mulmoterminal.json (overriding the user's app-wide choice for that cell).
export function termThemeFor(id: string): Theme["term"] {
  const builtin = THEMES.find((t) => t.id === id);
  if (builtin) return builtin.term;
  const custom = findCustomTheme(id);
  // A custom theme's canvas colours are derived from its chrome variables, and the 16 ANSI
  // colours come from the base it extends — hence the spread over that base's palette. Its own
  // `term` block rides along inside `derived` and wins over both (#2097).
  const derived = custom ? customTermTheme(custom, builtins()) : null;
  const base = THEMES.find((t) => t.id === custom?.extends) ?? THEMES[0];
  const fallback = THEMES[0];
  if (!fallback) return {};
  return derived ? { ...(base?.term ?? fallback.term), ...derived } : fallback.term;
}

// Called from main.ts before mount so the persisted theme is on <html> before
// the first paint (no flash of the default palette).
export function initTheme() {
  applyTheme(themeId.value);
}

/** Re-paint the current selection. Called once the custom themes have arrived from the server:
 *  before that a custom id resolves to nothing, so the app starts on the default and switches
 *  when the config lands. */
export function refreshTheme() {
  applyTheme(themeId.value);
}

// The three dots the picker shows for a custom theme, from its own resolved colours.
function swatchFor(id: string): Theme["swatch"] {
  const custom = findCustomTheme(id);
  const vars = custom ? resolveThemeVars(custom, builtins()) : null;
  const fallbackSwatch = THEMES[0]?.swatch ?? { base: "", panel: "", accent: "" };
  if (!vars) return fallbackSwatch;
  return { base: vars["--bg-base"], panel: vars["--bg-panel"], accent: vars["--accent"] };
}

export function useTheme() {
  function setTheme(id: string) {
    themeId.value = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage blocked: the theme still applies for this session, just isn't persisted
    }
    applyTheme(id);
  }
  // Built-ins first, then the user's own — the four everyone has, then the ones only this
  // machine's config knows about.
  const themes = computed<Theme[]>(() => [
    ...THEMES,
    ...customThemeList.value.map((theme) => ({
      id: theme.id,
      label: theme.label,
      swatch: swatchFor(theme.id),
      term: termThemeFor(theme.id),
    })),
  ]);
  return { themeId, themes, setTheme, missingThemeId };
}
