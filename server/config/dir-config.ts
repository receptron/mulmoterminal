// Per-directory overrides read from <cwd>/.mulmoterminal.json: a terminal opened in
// a directory can carry its own xterm palette, a badge label/color, and an attention
// sound. Every field is optional; a missing or malformed file yields all-null so the
// terminal falls back to the global theme/sound. Field validation lives in the zod
// schemas of config-schema.ts; the path-confinement check for `sound` (the security
// surface) stays here because it touches the filesystem.
import { existsSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { sanitizeButtons, sanitizeChips } from "./header-config.js";
import { EMPTY_DIR_CHROME, type DirChrome } from "../../common/dirChrome.js";
import {
  describeDirConfig,
  keysWithValue,
  EMPTY_DIR_CONFIG_SOURCE,
  EMPTY_DIR_CONFIG_EXTRAS,
  type DirConfigSource,
  type DirConfigExtras,
} from "../../common/dirConfigSource.js";
import { isWithin } from "../infra/path-within.js";
import { readJsonFile } from "../infra/read-text-file.js";
import { isRecord } from "../../common/isRecord.js";
import { isBuiltinThemeId } from "../../common/themeVars.js";
import { getCustomThemeIds } from "./config-routes.js";

// A theme id this app can actually paint: a built-in, or one the user defined in the global
// config's `themes` (#996). Anything else is a typo — dropped here so the key lands in the
// "ignored" list Settings shows, rather than being kept and quietly rendering the default.
function resolvableTheme(id: string | null): string | null {
  if (id === null) return null;
  return isBuiltinThemeId(id) || getCustomThemeIds().includes(id) ? id : null;
}
import { writtenFilePath } from "../files/tool-writes.js";
import { NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds.js";
import { parsePresetRef } from "../../common/notifySounds.js";
import {
  dirNameField,
  dirColorField,
  dirThemeField,
  dirColorsField,
  dirFontSizeField,
  dirFontFamilyField,
  dirOrderPriorityField,
  dirSkillsField,
  dirProviderField,
  dirModelField,
  dirAppendSystemPromptField,
  type ThemeId,
  type HeaderButton,
  type HeaderChip,
  resolveAddDirs,
} from "./config-schema.js";

const DIR_CONFIG_FILE = ".mulmoterminal.json";

export interface DirConfig extends DirChrome {
  theme: ThemeId | null;
  // Per-key xterm palette overrides (on top of `theme`), or null when none are valid.
  colors: Record<string, string> | null;
  // Absolute path to the attention sound, resolved within cwd; null when unset or the
  // configured path is absolute / escapes the directory / doesn't exist. The fallback for
  // EVERY notification kind; `sounds` overrides it per kind.
  sound: string | null;
  // Per-kind overrides of `sound` (#873), each either a preset or a file inside cwd.
  sounds: Partial<Record<NotifyKind, DirSound>>;
  // Per-project terminal-header action buttons (merged over the global ones by id).
  // null = this dir doesn't configure buttons.
  buttons: HeaderButton[] | null;
  // Per-project header display chips, or null when this dir doesn't configure them.
  chips: HeaderChip[] | null;
  // Header Skill-menu allowlist: show only these skill slugs, in this order. null =
  // this dir doesn't filter, so the menu shows every discovered skill.
  skills: string[] | null;
  // Which backend/model this directory's sessions run on (#579). Never a secret.
  provider: string | null;
  model: string | null;
  // Extra directories this dir's sessions may touch (#908) — already resolved to absolute
  // paths against the config's own directory, and already checked to exist.
  addDirs: string[] | null;
  // Whether this directory's sessions carry the built-in closing-summary instructions (#1062).
  // null = the key is absent, so the global `appendSystemPrompt` decides.
  appendSystemPrompt: boolean | null;
}

// What the browser receives: the raw sound path stays server-side (streamed via
// /api/dir-sound), so the client only learns whether one exists.
//
// Listed rather than derived from DirConfig, so the wire shape reads in one place
// instead of as "the server type minus four names" — a reader can see what leaves
// the server without also holding DirConfig in their head.
export interface PublicDirConfig extends DirChrome {
  theme: ThemeId | null;
  colors: Record<string, string> | null;
  hasSound: boolean;
}

/** The directory whose `.mulmoterminal.json` a tool call just wrote, or null for anything else.
 *  Narrows the general "which file did this write" (writtenFilePath) rather than restating its
 *  rules, so the config's live reload and the editor's change feed can't drift apart. */
export function dirConfigWriteTarget(toolName: unknown, toolInput: unknown, sessionCwd: string | null = null): string | null {
  const file = writtenFilePath(toolName, toolInput, sessionCwd);
  return file && path.basename(file) === DIR_CONFIG_FILE ? path.dirname(file) : null;
}

// A directory's sound for one notification kind: its own audio file, or one of the built-in
// presets. The preset arm carries no path — the id is matched against a fixed catalog — so a
// project can pick a sound without shipping an mp3 and without widening what it can read.
export type DirSound = { source: "file"; path: string } | { source: "preset"; id: string };

// One `sounds` entry: a `preset:<id>` reference, else a file confined to cwd by resolveDirSound.
export function resolveDirSoundValue(cwd: string, input: unknown): DirSound | null {
  if (typeof input !== "string") return null;
  const presetId = parsePresetRef(input.trim());
  if (presetId) return { source: "preset", id: presetId };
  const file = resolveDirSound(cwd, input);
  return file ? { source: "file", path: file } : null;
}

function resolveDirSounds(cwd: string, input: unknown): Partial<Record<NotifyKind, DirSound>> {
  if (!isRecord(input)) return {};
  const out: Partial<Record<NotifyKind, DirSound>> = {};
  NOTIFY_KINDS.forEach((kind) => {
    const resolved = resolveDirSoundValue(cwd, input[kind]);
    if (resolved) out[kind] = resolved;
  });
  return out;
}

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
  if (!isWithin(base, resolved)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  try {
    // .native for the 8.3 reason in files/pathContainment.ts — one spelling of a Windows path.
    if (!isWithin(realpathSync.native(base), realpathSync.native(resolved))) return null;
  } catch {
    return null;
  }
  return resolved;
}

const EMPTY: DirConfig = {
  ...EMPTY_DIR_CHROME,
  theme: null,
  colors: null,
  sound: null,
  sounds: {},
  buttons: null,
  chips: null,
  skills: null,
  provider: null,
  model: null,
  addDirs: null,
  appendSystemPrompt: null,
};

export function loadDirConfig(cwd: string): DirConfig {
  try {
    const base = path.resolve(cwd);
    const file = path.join(base, DIR_CONFIG_FILE);
    if (!existsSync(file)) return EMPTY;
    const raw: unknown = readJsonFile(file);
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
      fontSize: dirFontSizeField.parse(raw.fontSize),
      fontFamily: dirFontFamilyField.parse(raw.fontFamily),
      orderPriority: dirOrderPriorityField.parse(raw.orderPriority),
      theme: resolvableTheme(dirThemeField.parse(raw.theme)),
      colors: dirColorsField.parse(raw.colors),
      sound: resolveDirSound(base, raw.sound),
      sounds: resolveDirSounds(base, raw.sounds),
      buttons: sanitizeButtons(raw.buttons),
      chips: sanitizeChips(raw.chips),
      skills: dirSkillsField.parse(raw.skills),
      provider: dirProviderField.parse(raw.provider),
      model: dirModelField.parse(raw.model),
      addDirs: resolveAddDirs(raw.addDirs, base, (p) => statSync(p).isDirectory()),
      appendSystemPrompt: dirAppendSystemPromptField.parse(raw.appendSystemPrompt),
    };
  } catch {
    return EMPTY;
  }
}

export function publicDirConfig(cwd: string): PublicDirConfig {
  const {
    name,
    badgeColor,
    headerColor,
    headerTextColor,
    cellColor,
    cellBorderColor,
    dotColor,
    buttonColor,
    fontSize,
    fontFamily,
    orderPriority,
    theme,
    colors,
    sound,
    sounds,
  } = loadDirConfig(cwd);
  return {
    name,
    badgeColor,
    headerColor,
    headerTextColor,
    cellColor,
    cellBorderColor,
    dotColor,
    buttonColor,
    fontSize,
    fontFamily,
    orderPriority,
    theme,
    colors,
    hasSound: sound !== null || Object.keys(sounds).length > 0,
  };
}

// The settings modal's read-only preview of one directory: what the app resolved, plus which
// keys the file set and how each fared. Separate from publicDirConfig because every cell polls
// that one — this is fetched only while the modal is open, and it re-reads the file to say what
// the resolved values alone can't: that a key was written and then dropped, or misspelled.
export interface DirConfigDetail {
  // False when the requested directory itself is gone — a preset outliving its project. The
  // preview must not present that as "no config here", which reads as a working directory.
  exists: boolean;
  // Absolute path of the file, or null when the directory has none.
  file: string | null;
  config: PublicDirConfig;
  // Everything else the file can set. Separate from `config` because that shape is what every
  // cell fetches on mount, and none of this is of any use to a running terminal.
  extras: DirConfigExtras;
  source: DirConfigSource;
}

// A chip is either a builtin's id or a custom { label, text } — either way its label is the
// string a reader recognises on the header.
const chipLabel = (chip: HeaderChip): string => (typeof chip === "string" ? chip : chip.label);

function dirConfigExtras(cwd: string): DirConfigExtras {
  const { provider, model, skills, addDirs, appendSystemPrompt, buttons, chips } = loadDirConfig(cwd);
  return {
    provider,
    model,
    skills,
    addDirs,
    appendSystemPrompt,
    buttonLabels: (buttons ?? []).map((button) => button.label),
    chipLabels: (chips ?? []).map(chipLabel),
  };
}

// The file, when the directory has one at all. Null also covers an unreadable path — the
// preview then says "no file", which is what the app itself concluded.
function dirConfigFile(cwd: string): string | null {
  try {
    const file = path.join(path.resolve(cwd), DIR_CONFIG_FILE);
    return existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

// What a directory that isn't there reports: no file, no settings, and `exists: false` so the
// preview can say "this directory is gone" instead of "it uses the global settings".
export const MISSING_DIR_CONFIG_DETAIL: DirConfigDetail = {
  exists: false,
  file: null,
  config: { ...EMPTY_DIR_CHROME, theme: null, colors: null, hasSound: false },
  extras: EMPTY_DIR_CONFIG_EXTRAS,
  source: EMPTY_DIR_CONFIG_SOURCE,
};

export function dirConfigDetail(cwd: string): DirConfigDetail {
  const config = publicDirConfig(cwd);
  const file = dirConfigFile(cwd);
  if (!file) return { exists: true, file: null, config, extras: EMPTY_DIR_CONFIG_EXTRAS, source: EMPTY_DIR_CONFIG_SOURCE };
  const extras = dirConfigExtras(cwd);
  // Malformed or non-object JSON keeps the FILE in the answer: "there is a file here and none
  // of it applied" is the single most useful thing this preview can say, and reporting no file
  // at all would send the reader looking for one that is right there.
  const raw: unknown = tryReadJson(file);
  if (!isRecord(raw)) return { exists: true, file, config, extras, source: EMPTY_DIR_CONFIG_SOURCE };
  return { exists: true, file, config, extras, source: describeDirConfig(raw, keysWithValue(loadDirConfig(cwd))) };
}

function tryReadJson(file: string): unknown {
  try {
    return readJsonFile(file);
  } catch {
    return null;
  }
}

// The sound this directory wants for one kind: its per-kind entry, else its all-kind
// `sound`. Null when the directory configures neither — the caller then falls back to the
// user's global sound and finally to the built-in chime.
export function dirSoundFor(cwd: string, kind: NotifyKind | null): DirSound | null {
  const config = loadDirConfig(cwd);
  const perKind = kind ? config.sounds[kind] : undefined;
  if (perKind) return perKind;
  return config.sound ? { source: "file", path: config.sound } : null;
}
