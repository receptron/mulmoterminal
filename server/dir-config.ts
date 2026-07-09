// Per-directory overrides read from <cwd>/.mulmoterminal.json: a terminal opened in
// a directory can carry its own xterm palette, a badge label/color, and an attention
// sound. Every field is optional; a missing or malformed file yields all-null so the
// terminal falls back to the global theme/sound. Field validation lives in the zod
// schemas of config-schema.ts; the path-confinement check for `sound` (the security
// surface) stays here because it touches the filesystem.
import { existsSync, readFileSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { sanitizeButtons, sanitizeChips } from "./header-config.js";
import { dirNameField, dirColorField, dirThemeField, dirColorsField, type ThemeId, type HeaderButton, type HeaderChip } from "./config-schema.js";

const DIR_CONFIG_FILE = ".mulmoterminal.json";

export interface DirConfig {
  name: string | null;
  badgeColor: string | null;
  // The cell header's own background / text color (grid cell + single view). Hex
  // #rrggbb, or null to keep the theme default. Distinct from `colors` (the xterm
  // palette) — these tint the chrome around the terminal, not the terminal itself.
  headerColor: string | null;
  headerTextColor: string | null;
  // The cell frame + accents (grid cell): body background, border, the idle status
  // dot, and the header's icon buttons. Hex #rrggbb or null for the theme default.
  cellColor: string | null;
  cellBorderColor: string | null;
  dotColor: string | null;
  buttonColor: string | null;
  theme: ThemeId | null;
  // Per-key xterm palette overrides (on top of `theme`), or null when none are valid.
  colors: Record<string, string> | null;
  // Absolute path to the attention sound, resolved within cwd; null when unset or the
  // configured path is absolute / escapes the directory / doesn't exist.
  sound: string | null;
  // Per-project terminal-header action buttons (merged over the global ones by id).
  buttons: HeaderButton[];
  // Per-project header display chips, or null when this dir doesn't configure them.
  chips: HeaderChip[] | null;
}

// What the browser receives: the raw sound path stays server-side (streamed via
// /api/dir-sound), so the client only learns whether one exists.
export interface PublicDirConfig {
  name: string | null;
  badgeColor: string | null;
  headerColor: string | null;
  headerTextColor: string | null;
  cellColor: string | null;
  cellBorderColor: string | null;
  dotColor: string | null;
  buttonColor: string | null;
  theme: ThemeId | null;
  colors: Record<string, string> | null;
  hasSound: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// Claude's tool hooks already report every write, so they double as the live-reload signal — no
// filesystem watchers (cwds are scattered, so a watcher can't be shared across terminals).
const WRITE_TOOLS: ReadonlySet<string> = new Set(["Write", "Edit", "MultiEdit"]);

/** The directory whose `.mulmoterminal.json` a tool call just wrote, or null for anything else. */
export function dirConfigWriteTarget(toolName: unknown, toolInput: unknown): string | null {
  if (typeof toolName !== "string" || !WRITE_TOOLS.has(toolName)) return null;
  if (!isRecord(toolInput) || typeof toolInput.file_path !== "string") return null;
  const file = toolInput.file_path;
  if (path.basename(file) !== DIR_CONFIG_FILE) return null;
  return path.dirname(path.resolve(file));
}

const isInside = (base: string, target: string): boolean => target === base || target.startsWith(base + path.sep);

// Confine the configured sound to a real file INSIDE cwd. Relative paths only;
// anything absolute or escaping via "../" is rejected so an opened project can't
// point the player at arbitrary files on disk. The lexical check only constrains the
// path string, so we ALSO canonicalize with realpath and re-check — otherwise a file
// inside cwd that is a symlink to a target outside it would slip through.
export function resolveDirSound(cwd: string, input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.trim();
  if (!rel || path.isAbsolute(rel)) return null;
  const base = path.resolve(cwd);
  const resolved = path.resolve(base, rel);
  if (!isInside(base, resolved)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  try {
    if (!isInside(realpathSync(base), realpathSync(resolved))) return null;
  } catch {
    return null;
  }
  return resolved;
}

const EMPTY: DirConfig = {
  name: null,
  badgeColor: null,
  headerColor: null,
  headerTextColor: null,
  cellColor: null,
  cellBorderColor: null,
  dotColor: null,
  buttonColor: null,
  theme: null,
  colors: null,
  sound: null,
  buttons: [],
  chips: null,
};

export function loadDirConfig(cwd: string): DirConfig {
  try {
    const base = path.resolve(cwd);
    const file = path.join(base, DIR_CONFIG_FILE);
    if (!existsSync(file)) return EMPTY;
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(raw)) return EMPTY;
    return {
      name: dirNameField.parse(raw.name),
      badgeColor: dirColorField.parse(raw.badgeColor),
      headerColor: dirColorField.parse(raw.headerColor),
      headerTextColor: dirColorField.parse(raw.headerTextColor),
      cellColor: dirColorField.parse(raw.cellColor),
      cellBorderColor: dirColorField.parse(raw.cellBorderColor),
      dotColor: dirColorField.parse(raw.dotColor),
      buttonColor: dirColorField.parse(raw.buttonColor),
      theme: dirThemeField.parse(raw.theme),
      colors: dirColorsField.parse(raw.colors),
      sound: resolveDirSound(base, raw.sound),
      buttons: sanitizeButtons(raw.buttons),
      chips: sanitizeChips(raw.chips),
    };
  } catch {
    return EMPTY;
  }
}

export function publicDirConfig(cwd: string): PublicDirConfig {
  const { name, badgeColor, headerColor, headerTextColor, cellColor, cellBorderColor, dotColor, buttonColor, theme, colors, sound } = loadDirConfig(cwd);
  return { name, badgeColor, headerColor, headerTextColor, cellColor, cellBorderColor, dotColor, buttonColor, theme, colors, hasSound: sound !== null };
}

export function dirSoundFile(cwd: string): string | null {
  return loadDirConfig(cwd).sound;
}
