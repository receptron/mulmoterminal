import { ref } from "vue";
import type { ITheme } from "@xterm/xterm";
import type { ThemeId } from "../../common/themeIds";

export type { ThemeId };

export interface Theme {
  id: ThemeId;
  label: string;
  // Three representative colors shown as the picker swatch.
  swatch: { base: string; panel: string; accent: string };
  // xterm renders on a canvas and can't read CSS variables, so each theme carries
  // an explicit terminal palette mirroring its CSS tokens. Light themes also set
  // the 16 ANSI colors (mapping bright-white to a dark tone) so colored TUI output
  // stays legible on a light background — xterm's defaults assume a dark canvas.
  term: ITheme;
}

export const THEMES: Theme[] = [
  {
    id: "midnight",
    label: "Midnight",
    swatch: { base: "#1a1a2e", panel: "#16213e", accent: "#4a8cff" },
    term: { background: "#1a1a2e", foreground: "#e0e0e0", cursor: "#e0e0e0", selectionBackground: "#3a3a5e" },
  },
  {
    id: "nord",
    label: "Nord",
    swatch: { base: "#2e3440", panel: "#3b4252", accent: "#88c0d0" },
    term: { background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e" },
  },
  {
    id: "daylight",
    label: "Daylight",
    swatch: { base: "#f4f6fb", panel: "#ffffff", accent: "#2563eb" },
    term: {
      background: "#f4f6fb",
      foreground: "#1b2430",
      cursor: "#1b2430",
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

// Storage access can throw (private mode / sandboxed contexts with storage
// blocked), so persistence is best-effort: a failure falls back to the default
// rather than crashing app startup.
function loadThemeId(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemeId(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const themeId = ref<ThemeId>(loadThemeId());

function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
}

// The xterm palette for the active theme; Terminal.vue feeds this into the
// terminal's `theme` option and refreshes it whenever the theme changes.
export function currentTermTheme(): Theme["term"] {
  return (THEMES.find((t) => t.id === themeId.value) ?? THEMES[0]).term;
}

// The xterm palette for a specific theme — used by a terminal whose directory pins a
// theme via .mulmoterminal.json (overriding the user's app-wide choice for that cell).
export function termThemeFor(id: ThemeId): Theme["term"] {
  return (THEMES.find((t) => t.id === id) ?? THEMES[0]).term;
}

// Called from main.ts before mount so the persisted theme is on <html> before
// the first paint (no flash of the default palette).
export function initTheme() {
  applyTheme(themeId.value);
}

export function useTheme() {
  function setTheme(id: ThemeId) {
    themeId.value = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage blocked: the theme still applies for this session, just isn't persisted
    }
    applyTheme(id);
  }
  return { themeId, themes: THEMES, setTheme };
}
