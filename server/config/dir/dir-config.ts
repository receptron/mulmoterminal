// Per-directory overrides read from <cwd>/.mulmoterminal.json: a terminal opened in
// a directory can carry its own xterm palette, a badge label/color, and an attention
// sound. Every field is optional; a missing or malformed file yields all-null so the
// terminal falls back to the global theme/sound. Field validation lives in the zod
// schemas of config-schema.ts; the path-confinement check for `sound` (the security
// surface) stays here because it touches the filesystem.
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { sanitizeButtons, sanitizeChips } from "../header/header-config.js";
import { EMPTY_DIR_CHROME, type DirChrome } from "../../../common/dirChrome.js";
import {
  describeDirConfig,
  keysWithValue,
  EMPTY_DIR_CONFIG_SOURCE,
  EMPTY_DIR_CONFIG_EXTRAS,
  type DirConfigSource,
  type DirConfigExtras,
} from "../../../common/dirConfigSource.js";
import { resolveDirWithinDir, resolveFileWithinDir } from "./dir-file.js";
import { isExcludedSegment, type MobileFileExtension } from "../../../common/mobileFiles.js";
import { resolveDirIcon, dirIconImage, dirIconNamed, dirIconRef, type DirIcon, type DirIconSetting } from "./dir-icon.js";
import { resolveDirBackground, type DirBackground } from "./dir-background.js";
import { DIR_BACKGROUND_ROUTE, type PublicDirBackground } from "../../../common/dirBackground.js";
import { detectDirIcon } from "./dir-icon-detect.js";
import { getAutoDirIcon } from "../config-routes.js";
import { DIR_ICON_ROUTE } from "../../../common/dirIcon.js";
import { readJsonFile } from "../../infra/fs/read-text-file.js";
import { repoJsonConfig, repoJsonPath } from "./repo-json.js";
import { isRecord } from "../../../common/isRecord.js";
import { DIR_FORM_KEYS } from "../../../common/dirConfigForm.js";
import type { WorktreeEnvSpec } from "../../../common/worktreeEnv.js";
import { isBuiltinThemeId } from "../../../common/themeVars.js";
import { getCustomThemeIds } from "../config-routes.js";

// A theme id this app can actually paint: a built-in, or one the user defined in the global
// config's `themes` (#996). Anything else is a typo — dropped here so the key lands in the
// "ignored" list Settings shows, rather than being kept and quietly rendering the default.
function resolvableTheme(id: string | null): string | null {
  if (id === null) return null;
  return isBuiltinThemeId(id) || getCustomThemeIds().includes(id) ? id : null;
}
import { writtenFilePath } from "../../files/tool-writes.js";
import { NOTIFY_KINDS, type NotifyKind } from "../../../common/notifyKinds.js";
import { parsePresetRef } from "../../../common/notifySounds.js";
import {
  dirNameField,
  dirColorField,
  dirHeaderStatusColorsField,
  dirHeaderStatusTintField,
  dirThemeField,
  dirColorsField,
  dirFontSizeField,
  dirFontFamilyField,
  dirOrderPriorityField,
  dirSkillsField,
  dirDecksField,
  dirMobileFilesField,
  dirProviderField,
  dirModelField,
  dirAppendSystemPromptField,
  dirWorktreeEnvField,
  type ThemeId,
  type HeaderEntry,
  type HeaderChip,
  resolveAddDirs,
} from "../config-schema.js";

import { dirReviewField } from "../review-schema.js";
import { reviewSummary, type ReviewSettings } from "../../../common/reviewSettings.js";

export const DIR_CONFIG_FILE = ".mulmoterminal.json";
// The same settings for THIS checkout only (#1430). Several clones of one repository share a
// project config and differ in nothing but their colours and grid rank, so the shared part lives
// in the file above — which a single-clone user can have on its own, colours included — and this
// one takes over the handful of keys that make one clone distinguishable from the next.
export const DIR_LOCAL_CONFIG_FILE = ".mulmoterminal.local.json";

export interface DirConfig extends DirChrome {
  theme: ThemeId | null;
  // Per-key xterm palette overrides (on top of `theme`), or null when none are valid.
  colors: Record<string, string> | null;
  // The attention sound for EVERY notification kind — a preset, or a file resolved within cwd —
  // or null when unset or the configured path is absolute / escapes the directory / doesn't
  // exist. `sounds` overrides it per kind, and takes the same two forms.
  sound: DirSound | null;
  // Per-kind overrides of `sound` (#873), each either a preset or a file inside cwd.
  sounds: Partial<Record<NotifyKind, DirSound>>;
  // What the FILE said about this directory's image (#1421): an icon, `"off"` for an explicit
  // `false`, or null for unset. Deliberately NOT the icon that ends up on screen — auto-detection
  // (#1428) happens in dirIconFor, so that a worktree inherits what was written rather than what
  // was found, and the settings preview can still report which keys the file actually set.
  icon: DirIconSetting;
  // A picture shown faintly behind this directory's terminals, or null when unset or unusable.
  backgroundImage: DirBackground | null;
  // Per-project terminal-header action buttons (merged over the global ones by id).
  // null = this dir doesn't configure buttons.
  buttons: HeaderEntry[] | null;
  // Per-project header display chips, or null when this dir doesn't configure them.
  chips: HeaderChip[] | null;
  // Per-project command-palette entries, shaped like buttons (#2465); [] when none.
  commands: HeaderEntry[];
  // Header Skill-menu allowlist: show only these skill slugs, in this order. null =
  // this dir doesn't filter, so the menu shows every discovered skill.
  skills: string[] | null;
  decks: string[] | null;
  // What the phone may see (#2911): each declared directory already resolved to an absolute path
  // and contained in this one. null when nothing survived, so the project stays invisible.
  mobileFiles: MobileFilesConfig | null;
  // Which backend/model this directory's sessions run on (#579). Never a secret.
  provider: string | null;
  model: string | null;
  // Extra directories this dir's sessions may touch (#908) — already resolved to absolute
  // paths against the config's own directory, and already checked to exist.
  addDirs: string[] | null;
  // Whether this directory's sessions carry the built-in closing-summary instructions (#1062).
  // null = the key is absent, so the global `appendSystemPrompt` decides.
  appendSystemPrompt: boolean | null;
  // Which variables every working tree of this project needs its own value of (#1367). The
  // DECLARATION, not the values — reserving those touches disk and lives in worktree-env.ts.
  worktreeEnv: WorktreeEnvSpec | null;
  // How this repository wants its changes reviewed (#3407), defaults filled in; null when the file
  // declares none or the block does not validate.
  review: ReviewSettings | null;
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
  // Ready for an `<img src>`: this app's own /api/dir-icon route for a file inside the
  // directory, or the remote URL verbatim. The file PATH stays server-side, like `sound`'s.
  iconUrl: string | null;
  // The same for the terminal background, with how faint and how fitted.
  backgroundImage: PublicDirBackground | null;
}

/** The directory whose `.mulmoterminal.json` a tool call just wrote, or null for anything else.
 *  Narrows the general "which file did this write" (writtenFilePath) rather than restating its
 *  rules, so the config's live reload and the editor's change feed can't drift apart. */
export function dirConfigWriteTarget(toolName: unknown, toolInput: unknown, sessionCwd: string | null = null): string | null {
  const file = writtenFilePath(toolName, toolInput, sessionCwd);
  return file ? dirConfigDirOf(file) : null;
}

/** The directory whose config `file` is, when it is one of the two config files; else null.
 *  Either file — a clone's local override is the one a user edits most, and reloading only on the
 *  shared file would leave the very setting they just changed not applying (#1430). */
export function dirConfigDirOf(file: string): string | null {
  const name = path.basename(file);
  return name === DIR_CONFIG_FILE || name === DIR_LOCAL_CONFIG_FILE ? path.dirname(file) : null;
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

// Confine the configured sound to a real file INSIDE cwd, so an opened project can't point the
// player at arbitrary files on disk — the shared rule, see dir-file.ts for what it checks.
export function resolveDirSound(cwd: string, input: unknown): string | null {
  if (typeof input !== "string") return null;
  const rel = input.trim();
  if (!rel) return null;
  return resolveFileWithinDir(cwd, rel);
}

const EMPTY: DirConfig = {
  ...EMPTY_DIR_CHROME,
  theme: null,
  colors: null,
  sound: null,
  sounds: {},
  icon: null,
  backgroundImage: null,
  buttons: null,
  chips: null,
  commands: [],
  skills: null,
  decks: null,
  mobileFiles: null,
  provider: null,
  model: null,
  addDirs: null,
  appendSystemPrompt: null,
  worktreeEnv: null,
  review: null,
};

/** Every layer as ONE object, the more specific winning per top-level key.
 *
 *  General to specific: the open `repo.json` (#1442), then this app's shared file, then this
 *  checkout's own. A repository says what it is to every tool; `.mulmoterminal.json` says what
 *  this app should do with it; the local file says what THIS clone looks like.
 *
 *  Merged as raw JSON and validated afterwards, rather than loaded three times and combined: every
 *  rule about what a value may be then stays written once, and a relative `icon` / `sound` /
 *  `addDirs` resolves against this directory whichever file it came from.
 *
 *  Whole keys, not a deep merge. One key is one intent — the seven colours are already separate
 *  keys, so "this clone is the green one" reads naturally — and a `colors` block a reader has to
 *  assemble from two files is harder to predict than one they can see entire. */
export function mergedDirConfigRaw(base: string): { raw: Record<string, unknown>; repoKeys: string[]; localKeys: string[] } {
  const repo = repoJsonConfig(base);
  const shared = readConfigObject(path.join(base, DIR_CONFIG_FILE));
  const local = readConfigObject(path.join(base, DIR_LOCAL_CONFIG_FILE));
  return { raw: { ...repo, ...shared, ...local }, repoKeys: Object.keys(repo), localKeys: Object.keys(local) };
}

// A file that is missing, unreadable or not an object contributes nothing — the same tolerance the
// single file already had, now applied to each of the two independently, so a broken local file
// leaves the shared config working rather than taking the directory down with it.
function readConfigObject(file: string): Record<string, unknown> {
  try {
    if (!existsSync(file)) return {};
    const raw: unknown = readJsonFile(file);
    return isRecord(raw) ? raw : {};
  } catch {
    return {};
  }
}

export interface MobileFilesConfig {
  dirs: string[];
  extensions: MobileFileExtension[];
}

// Whether a contained directory sits, as written or once its links are followed, under a hidden or
// vendored segment — declaring `.git` must not open what the walk would never list.
function isExcludedRoot(base: string, dir: string): boolean {
  try {
    const segments = [path.relative(base, dir), path.relative(realpathSync.native(base), realpathSync.native(dir))].flatMap((rel) => rel.split(path.sep));
    return segments.some((segment) => segment !== "" && isExcludedSegment(segment));
  } catch {
    return true;
  }
}

// A declared directory that escapes the project, does not exist, is a file, or is hidden is dropped
// here, so the key lands in Settings' "ignored" list rather than widening what the phone can reach.
export function resolveMobileFiles(base: string, input: unknown): MobileFilesConfig | null {
  const declared = dirMobileFilesField.parse(input);
  if (!declared) return null;
  const dirs = declared.dirs.flatMap((ref) => resolveDirWithinDir(base, ref) ?? []).filter((dir) => !isExcludedRoot(base, dir));
  return dirs.length ? { dirs: [...new Set(dirs)], extensions: declared.extensions } : null;
}

export function loadDirConfig(cwd: string): DirConfig {
  try {
    const base = path.resolve(cwd);
    const { raw } = mergedDirConfigRaw(base);
    if (Object.keys(raw).length === 0) return EMPTY;
    return {
      name: dirNameField.parse(raw.name),
      badgeColor: dirColorField.parse(raw.badgeColor),
      headerColor: dirColorField.parse(raw.headerColor),
      headerTextColor: dirColorField.parse(raw.headerTextColor),
      headerStatusColors: dirHeaderStatusColorsField.parse(raw.headerStatusColors),
      headerStatusTint: dirHeaderStatusTintField.parse(raw.headerStatusTint),
      cellColor: dirColorField.parse(raw.cellColor),
      cellBorderColor: dirColorField.parse(raw.cellBorderColor),
      dotColor: dirColorField.parse(raw.dotColor),
      buttonColor: dirColorField.parse(raw.buttonColor),
      fontSize: dirFontSizeField.parse(raw.fontSize),
      fontFamily: dirFontFamilyField.parse(raw.fontFamily),
      orderPriority: dirOrderPriorityField.parse(raw.orderPriority),
      theme: resolvableTheme(dirThemeField.parse(raw.theme)),
      colors: dirColorsField.parse(raw.colors),
      sound: resolveDirSoundValue(base, raw.sound),
      sounds: resolveDirSounds(base, raw.sounds),
      icon: resolveDirIcon(base, raw.icon),
      backgroundImage: resolveDirBackground(base, raw.backgroundImage),
      buttons: sanitizeButtons(raw.buttons),
      chips: sanitizeChips(raw.chips),
      commands: sanitizeButtons(raw.commands) ?? [],
      skills: dirSkillsField.parse(raw.skills),
      decks: dirDecksField.parse(raw.decks),
      mobileFiles: resolveMobileFiles(base, raw.mobileFiles),
      provider: dirProviderField.parse(raw.provider),
      model: dirModelField.parse(raw.model),
      addDirs: resolveAddDirs(raw.addDirs, base, (p) => statSync(p).isDirectory()),
      appendSystemPrompt: dirAppendSystemPromptField.parse(raw.appendSystemPrompt),
      worktreeEnv: dirWorktreeEnvField.parse(raw.worktreeEnv),
      review: dirReviewField.parse(raw.review),
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
    headerStatusColors,
    headerStatusTint,
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
    icon,
    backgroundImage,
  } = loadDirConfig(cwd);
  return {
    name,
    badgeColor,
    headerColor,
    headerTextColor,
    headerStatusColors,
    headerStatusTint,
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
    iconUrl: dirIconUrl(cwd, dirIconFor(cwd, icon)),
    backgroundImage: publicDirBackground(cwd, backgroundImage),
  };
}

/** The icon a directory's cells actually show: what its file named, else — when the file named
 *  nothing at all — whatever the repository already carries (#1428).
 *
 *  Auto-detection is skipped for BOTH an explicit `icon: false` and a global `autoDirIcon: false`,
 *  and also whenever the file named something: a written value that failed to resolve is a broken
 *  setting, and quietly showing a different picture would hide it. */
export function dirIconFor(cwd: string, setting: DirIconSetting = loadDirConfig(cwd).icon): DirIcon | null {
  if (dirIconNamed(setting)) return dirIconImage(setting);
  return getAutoDirIcon() ? detectDirIcon(cwd) : null;
}

// A directory's own file is served by us, so the browser gets a route rather than a path; a
// remote URL is already something the browser can fetch. The cwd is in the query for the same
// reason every other dir route takes one — the server re-reads the config to find the file.
function publicDirBackground(cwd: string, background: DirBackground | null): PublicDirBackground | null {
  if (!background) return null;
  const { image, opacity, fit } = background;
  const url = image.source === "url" ? image.url : `${DIR_BACKGROUND_ROUTE}?cwd=${encodeURIComponent(cwd)}`;
  return { url, opacity, fit };
}

function dirIconUrl(cwd: string, icon: DirIcon | null): string | null {
  if (!icon) return null;
  return icon.source === "url" ? icon.url : `${DIR_ICON_ROUTE}?cwd=${encodeURIComponent(cwd)}`;
}

// The settings modal's read-only preview of one directory: what the app resolved, plus which
// keys the file set and how each fared. Separate from publicDirConfig because every cell polls
// that one — this is fetched only while the modal is open, and it re-reads the file to say what
// the resolved values alone can't: that a key was written and then dropped, or misspelled.
export interface DirConfigDetail {
  // False when the requested directory itself is gone — a preset outliving its project. The
  // preview must not present that as "no config here", which reads as a working directory.
  exists: boolean;
  // Absolute path of the shared file, or null when the directory has none.
  file: string | null;
  // The same for this checkout's own overrides (#1430). Both can be present, and either can be
  // present alone — a clone may carry only local settings.
  localFile: string | null;
  // The open `repo.json` (#1442), when the repository ships one. It sits UNDER both of the above,
  // so a value it sets can be invisible in the resolved config — which is exactly why the panel
  // has to name the file.
  repoFile: string | null;
  config: PublicDirConfig;
  // Everything else the file can set. Separate from `config` because that shape is what every
  // cell fetches on mount, and none of this is of any use to a running terminal.
  extras: DirConfigExtras;
  source: DirConfigSource;
  // What this directory's own two files say for each key the Settings form edits (#2722), before
  // validation and without `repo.json`: the form shows and changes what is written HERE, which the
  // resolved `config` cannot tell apart from a value the repository offered underneath.
  formValues: Record<string, unknown>;
}

// A chip is either a builtin's id or a custom { label, text } — either way its label is the
// string a reader recognises on the header.
const chipLabel = (chip: HeaderChip): string => (typeof chip === "string" ? chip : chip.label);

function dirConfigExtras(cwd: string): DirConfigExtras {
  const { provider, model, skills, decks, mobileFiles, addDirs, appendSystemPrompt, buttons, chips, commands, icon, worktreeEnv, review } = loadDirConfig(cwd);
  return {
    provider,
    model,
    skills,
    decks,
    mobileFileDirs: (mobileFiles?.dirs ?? []).map((dir) => path.relative(cwd, dir) || "."),
    mobileFileExtensions: mobileFiles?.extensions ?? [],
    addDirs,
    appendSystemPrompt,
    buttonLabels: (buttons ?? []).map((button) => button.label),
    chipLabels: (chips ?? []).map(chipLabel),
    commandLabels: commands.map((command) => command.label),
    autoIcon: autoIconRef(cwd, icon),
    worktreeEnvNames: Object.keys(worktreeEnv ?? {}),
    reviewSummary: review ? reviewSummary(review) : null,
  };
}

// Which file an auto-detected icon (#1428) came from, relative to the directory — null when the
// icon is one the file named, or when there is none. The preview needs this because `iconUrl`
// alone cannot tell "I set this" from "MulmoTerminal found this", and a picture appearing on a
// project that configured nothing is exactly the thing someone opens this panel to explain.
function autoIconRef(cwd: string, setting: DirIconSetting): string | null {
  if (dirIconNamed(setting)) return null;
  const detected = dirIconFor(cwd, null);
  return detected?.source === "file" ? detected.ref : null;
}

// The file, when the directory has one at all. Null also covers an unreadable path — the
// preview then says "no file", which is what the app itself concluded.
function dirConfigFile(cwd: string, name: string): string | null {
  try {
    const file = path.join(path.resolve(cwd), name);
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
  localFile: null,
  repoFile: null,
  config: { ...EMPTY_DIR_CHROME, theme: null, colors: null, hasSound: false, iconUrl: null, backgroundImage: null },
  extras: EMPTY_DIR_CONFIG_EXTRAS,
  source: EMPTY_DIR_CONFIG_SOURCE,
  formValues: {},
};

export function dirConfigDetail(cwd: string): DirConfigDetail {
  const config = publicDirConfig(cwd);
  const file = dirConfigFile(cwd, DIR_CONFIG_FILE);
  const localFile = dirConfigFile(cwd, DIR_LOCAL_CONFIG_FILE);
  const repoFile = repoJsonPath(cwd);
  if (!file && !localFile && !repoFile) {
    return {
      exists: true,
      file: null,
      localFile: null,
      repoFile: null,
      config,
      extras: EMPTY_DIR_CONFIG_EXTRAS,
      source: EMPTY_DIR_CONFIG_SOURCE,
      formValues: {},
    };
  }
  const extras = dirConfigExtras(cwd);
  // Both files, as the loader sees them. Malformed or non-object JSON keeps the FILE in the
  // answer: "there is a file here and none of it applied" is the single most useful thing this
  // preview can say, and reporting no file at all would send the reader looking for one that is
  // right there — which is now two places to look rather than one.
  const { raw, repoKeys, localKeys } = mergedDirConfigRaw(path.resolve(cwd));
  const formValues = dirFormValues(path.resolve(cwd));
  if (Object.keys(raw).length === 0) return { exists: true, file, localFile, repoFile, config, extras, source: EMPTY_DIR_CONFIG_SOURCE, formValues };
  // `icon: "invalid"` is a VALUE to keysWithValue, which would report the key as applied — the one
  // thing it must not say about a setting that did not take effect. Flattened to null here so the
  // key lands in "ignored", where a mistyped path belongs.
  const resolved = loadDirConfig(cwd);
  const kept = keysWithValue({ ...resolved, icon: dirIconRef(resolved.icon) });
  return { exists: true, file, localFile, repoFile, config, extras, source: { ...describeDirConfig(raw, kept), local: localKeys, repo: repoKeys }, formValues };
}

/** What this directory's own two files say, local over shared — no `repo.json` under them. */
export function dirOwnConfigRaw(cwd: string): Record<string, unknown> {
  const base = path.resolve(cwd);
  return { ...readConfigObject(path.join(base, DIR_CONFIG_FILE)), ...readConfigObject(path.join(base, DIR_LOCAL_CONFIG_FILE)) };
}

function dirFormValues(base: string): Record<string, unknown> {
  const written = dirOwnConfigRaw(base);
  return Object.fromEntries(DIR_FORM_KEYS.filter((key) => key in written).map((key) => [key, written[key]]));
}

// The sound this directory wants for one kind: its per-kind entry, else its all-kind
// `sound`. Null when the directory configures neither — the caller then falls back to the
// user's global sound and finally to the built-in chime.
export function dirSoundFor(cwd: string, kind: NotifyKind | null): DirSound | null {
  const config = loadDirConfig(cwd);
  const perKind = kind ? config.sounds[kind] : undefined;
  if (perKind) return perKind;
  return config.sound;
}
