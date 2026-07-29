// The app config persisted at ~/.mulmoterminal/config.json: the user's directory
// presets plus an optional custom attention-sound file. Unified read/write so a
// partial update (e.g. just the sound) never clobbers the other field. Extracted
// from config-routes.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { sanitizePresets } from "./cwd-presets.js";
import { sanitizeButtons, sanitizeChips } from "./header-config.js";
import {
  launcherSchema,
  quickCommandSchema,
  userMcpServerSchema,
  providerSchema,
  customThemeSchema,
  type CwdPreset,
  type Provider,
  type Launcher,
  type UserMcpServer,
  type HeaderButton,
  type HeaderChip,
  type CustomTheme,
} from "./config-schema.js";
import { DEFAULT_TERMINAL_SUBMIT_MODE, isTerminalSubmitMode, type TerminalSubmitMode } from "../../common/terminalSubmit.js";
import type { QuickCommand } from "../../common/quickCommands.js";
import { DEFAULT_PUSH_KINDS, PUSH_KINDS, type PushKind } from "../../common/pushKinds.js";
import { DEFAULT_SOUND_KINDS, NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds.js";
import { parsePresetRef } from "../../common/notifySounds.js";
import { isRecord } from "../../common/isRecord.js";
import { sanitizeKeymap, type Keymap } from "../../common/keymap.js";
import { sanitizeCockpitLines, DEFAULT_COCKPIT_LINES, type CockpitLines } from "../../common/cockpitLines.js";
import { normalizeFontFamily } from "../../common/terminalFontFamily.js";
import { readTextFile } from "../infra/read-text-file.js";
import { writeFileAtomicSync } from "../files/atomic-write.js";

export interface AppConfig {
  cwdPresets: CwdPreset[];
  // Absolute path to a user-supplied audio file played as the attention sound, or
  // null to use the built-in synthesized chime (the default — no bundled asset).
  // The fallback for EVERY kind; `sounds` overrides it per kind.
  soundFile: string | null;
  // Which moments beep at all (#873). The sound half of `pushKinds`: a user drowning in
  // beeps at eight parallel sessions can keep "it stopped to ask" and drop the rest.
  soundKinds: NotifyKind[];
  // Per-kind sound: a `preset:<id>` reference or an absolute path to the user's own file.
  // A kind with no entry falls back to `soundFile`, then to the built-in chime.
  sounds: Partial<Record<NotifyKind, string>>;
  // GitHub repos ("owner/repo") whose open PRs the cross-repo PR view aggregates.
  prRepos: string[];
  // User-defined launch commands offered in the grid cell launcher (label + command).
  launchers: Launcher[];
  // Phrases the phone offers as chips on a session's terminal view (#830), optionally
  // scoped to session kinds. Empty by default — no chips until the user adds one.
  quickCommands: QuickCommand[];
  // User-added HTTP MCP servers merged into the single-view session's --mcp-config.
  userMcpServers: UserMcpServer[];
  // Global terminal-header action buttons; applied to every terminal (scoped with `when`).
  // null = unconfigured (the runtime falls back to DEFAULT_BUTTONS).
  buttons: HeaderButton[] | null;
  // Global header display chips, or null when unconfigured (the client keeps its default set).
  chips: HeaderChip[] | null;
  // Send a Web Push (sendPush Cloud Function). Off by default; only fires while the RemoteHost
  // channel is connected (that's what supplies the Firebase auth). The master switch — which
  // KINDS it sends is `pushKinds`.
  pushEnabled: boolean;
  // Which kinds of push are wanted (#850). A push needs `pushEnabled` AND its kind here, so a
  // user who only wants finished turns can decline the ones a blocked agent raises — which on
  // a task that asks permission repeatedly is most of them.
  pushKinds: PushKind[];
  // Periodic dev-work log: a built-in scheduled task that summarizes recent work across
  // the saved working dirs into weekly wiki pages. Off by default (it spawns an LLM
  // session on each run, so it costs tokens). `worklogIntervalHours` is the cadence.
  worklogEnabled: boolean;
  worklogIntervalHours: number;
  // Anthropic-compatible backends a directory can point its sessions at (#579). Safe to
  // serve: an entry names the env var holding its key (`tokenEnv`), never the key.
  providers: Provider[];
  // Which received bytes the host's Claude reads as "submit" vs "newline" (#772). Drives
  // both the browser key handler and the phone remote-view submit. Default "cr".
  terminalSubmit: TerminalSubmitMode;
  // User-defined keyboard shortcuts (#829). NO defaults: an empty map means the shortcuts
  // are off, because every binding takes that key away from the terminal underneath.
  keymap: Keymap;
  // Append `work in <clone name>` to the body of PRs this app creates (#872), so a PR says
  // which of several side-by-side clones produced it. ON unless explicitly disabled — the
  // line is the whole point of the feature, and a reader who doesn't want it sets `false`.
  prWorkdirFooter: boolean;
  // Append the built-in closing-summary instructions to every spawned session's system prompt
  // (#942, opt-out in #1062). ON unless explicitly disabled, like the footer above: the grid is
  // what it exists for, and nothing in the app parses what it produces — a reader who doesn't
  // want the instruction sets `false`. A directory's own `.mulmoterminal.json` outranks this.
  appendSystemPrompt: boolean;
  // How many lines each cockpit-roster row shows before clamping (#877). Defaults keep the
  // previous 2/2/3; raising `summary` trades roster length for reading a long one in place.
  cockpitLines: CockpitLines;
  // Put a mouse selection on the clipboard the moment it settles, with no key pressed (#900).
  // Off unless asked for: it is the one setting that changes the clipboard when the user only
  // meant to highlight, and it is also the only place in the app that writes the clipboard on
  // its own — the `copy` keymap action merely stands back and lets the browser do it.
  copyOnSelect: boolean;
  // Leave a comment on the issue a cell is working on: once when the work starts, and again when
  // its PR merges (#979). OFF unless asked for — it writes to GitHub, on issues that are often
  // somebody else's, and the comment names the working directory it happened in.
  issueWorkComments: boolean;
  // Keep a Markdown digest of the decisions this project's sessions asked for, refreshed on a
  // timer, for an agent to read before asking something similar (#1015). OFF unless asked for:
  // it is a vision-stage idea rather than something every user needs, and it writes a file
  // (under ~/.mulmoterminal/decisions/) that would otherwise never exist.
  decisionDigest: boolean;
  // Colour schemes the user defined, offered in Settings alongside the four built-ins (#996).
  // Server-side rather than per-browser (like `fontFamily`, unlike `fontSize`): a palette you
  // authored is an asset you want on every browser you open the app from. WHICH one is selected
  // stays in localStorage, because "the dark one on this laptop" is a per-device answer.
  themes: CustomTheme[];
  // The CSS font-family stack every terminal renders in (#864), or null for the built-in one.
  // Global rather than per-browser (unlike `fontSize`) because it names FONTS, and which fonts
  // exist is a property of the machine the browser runs on — the same answer for every client
  // of one host. A directory's `.mulmoterminal.json` fontFamily overrides it.
  fontFamily: string | null;
}

// A user-defined colour scheme (#996). `extends` names a built-in to start from, so a theme
// that only recolours the accent is three lines; without it `colors` has to be complete.
const CUSTOM_THEMES_MAX = 24;
export function sanitizeCustomThemes(input: unknown): CustomTheme[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: CustomTheme[] = [];
  for (const value of input) {
    const parsed = customThemeSchema.safeParse(value);
    // A built-in id is refused rather than merged into: the guide describes what Midnight looks
    // like, and someone who reads it has to get that. `isUsableCustomThemeId` is inside the
    // schema, so a shadowing entry lands in the "dropped" list the Directory-settings panel shows.
    if (!parsed.success || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push(parsed.data);
    if (out.length >= CUSTOM_THEMES_MAX) break;
  }
  return out;
}

// `id` becomes an MCP server name + `mcp__<id>` tool prefix, so restrict to a plain
// slug. `url` must be an http(s) endpoint. Dedupe by id, cap the count.
const MCP_ID_RE = /^[A-Za-z0-9_-]+$/;
const MCP_URL_RE = /^https?:\/\/\S+$/;
const MCP_SERVERS_MAX = 20;
// The built-in GUI MCP server name — reserved so a user entry can't shadow it and
// break mcp__mulmoterminal-gui__* tool routing.
const RESERVED_MCP_IDS = new Set(["mulmoterminal-gui"]);
export function sanitizeUserMcpServers(input: unknown): UserMcpServer[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: UserMcpServer[] = [];
  for (const v of input) {
    const parsed = userMcpServerSchema.safeParse(v);
    if (!parsed.success) continue;
    const id = parsed.data.id.trim();
    const url = parsed.data.url.trim();
    if (!MCP_ID_RE.test(id) || RESERVED_MCP_IDS.has(id) || !MCP_URL_RE.test(url) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url });
    if (out.length >= MCP_SERVERS_MAX) break;
  }
  return out;
}

const LAUNCHER_LABEL_MAX = 40;
const LAUNCHER_COMMAND_MAX = 500;
const LAUNCHERS_MAX = 20;

// Keep entries with a non-empty label AND command (trimmed, length-capped), drop
// duplicate labels, cap the count. Labels are what the UI shows and what a persisted
// cell resolves back to, so they must be unique.
export function sanitizeLaunchers(input: unknown): Launcher[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Launcher[] = [];
  for (const v of input) {
    const parsed = launcherSchema.safeParse(v);
    if (!parsed.success) continue;
    const label = parsed.data.label.trim().slice(0, LAUNCHER_LABEL_MAX);
    const command = parsed.data.command.trim().slice(0, LAUNCHER_COMMAND_MAX);
    if (!label || !command || seen.has(label)) continue;
    seen.add(label);
    out.push({ label, command });
    if (out.length >= LAUNCHERS_MAX) break;
  }
  return out;
}

const QUICK_COMMAND_LABEL_MAX = 24;
const QUICK_COMMAND_TEXT_MAX = 500;
const QUICK_COMMANDS_MAX = 20;

// Same shape of rule as sanitizeLaunchers: non-empty label AND text, trimmed and capped,
// unique labels, bounded count. The label is short because it has to fit a phone chip.
// An `agents` array that survives the schema is kept as-is; an empty one is dropped so it
// means the same as omitting it (offered everywhere) rather than "offered to nothing".
export function sanitizeQuickCommands(input: unknown): QuickCommand[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: QuickCommand[] = [];
  for (const v of input) {
    const parsed = quickCommandSchema.safeParse(v);
    if (!parsed.success) continue;
    const label = parsed.data.label.trim().slice(0, QUICK_COMMAND_LABEL_MAX);
    const text = parsed.data.text.trim().slice(0, QUICK_COMMAND_TEXT_MAX);
    if (!label || !text || seen.has(label)) continue;
    seen.add(label);
    const agents = parsed.data.agents?.length ? [...new Set(parsed.data.agents)] : undefined;
    out.push(agents ? { label, text, agents } : { label, text });
    if (out.length >= QUICK_COMMANDS_MAX) break;
  }
  return out;
}

// "owner/repo" only — the value is passed to `gh pr list --repo`, so reject anything
// that isn't a plain slug (no spaces, flags, or paths). Trimmed, de-duplicated.
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
export function sanitizeRepos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const r = v.trim();
    if (REPO_RE.test(r)) seen.add(r);
  }
  return [...seen];
}

// Keep only a non-empty ABSOLUTE path; anything else (relative, blank, non-string)
// clears the custom sound. Absolute-only matches the documented contract and stops
// /api/sound from resolving a relative value against the server's cwd.
export function sanitizeSoundFile(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed && path.isAbsolute(trimmed) ? trimmed : null;
}

export function sanitizePushEnabled(input: unknown): boolean {
  return input === true;
}

// A per-kind sound value: a known `preset:<id>`, or an absolute path to the user's own file
// under the same rule as `soundFile`. Anything else drops that ENTRY, not the whole map — a
// typo in one kind must not cost the user the sounds they set on the others.
export function sanitizeSoundValue(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (parsePresetRef(trimmed)) return trimmed;
  return sanitizeSoundFile(trimmed);
}

export function sanitizeSounds(input: unknown): Partial<Record<NotifyKind, string>> {
  if (!isRecord(input)) return {};
  const out: Partial<Record<NotifyKind, string>> = {};
  NOTIFY_KINDS.forEach((kind) => {
    const value = sanitizeSoundValue(input[kind]);
    if (value) out[kind] = value;
  });
  return out;
}

// Same shape as sanitizePushKinds, and for the same reason: a NON-ARRAY (missing, or a
// config written before #873) means "never chose", so it gets the defaults, while an
// explicit `[]` is the user saying "no sounds at all" and is kept.
export function sanitizeSoundKinds(input: unknown): NotifyKind[] {
  if (!Array.isArray(input)) return [...DEFAULT_SOUND_KINDS];
  return NOTIFY_KINDS.filter((kind) => input.includes(kind));
}

// Keep the kinds that exist, de-duplicated and in the canonical order so the stored file reads
// the same whatever order the UI sent. A NON-ARRAY (missing, or a config written before #850)
// falls back to the defaults — an upgrading user must not silently lose their notifications.
// An explicit `[]` is a real answer and is kept: it means "none", which is how the user turns
// every kind off while leaving the master switch alone.
export function sanitizePushKinds(input: unknown): PushKind[] {
  if (!Array.isArray(input)) return [...DEFAULT_PUSH_KINDS];
  return PUSH_KINDS.filter((kind) => input.includes(kind));
}

// The Enter-key submit/newline byte mapping. Anything that isn't a known mode (missing,
// typo, wrong type) falls back to the standard binding, so a bad value never changes how
// Enter behaves.
export function sanitizeTerminalSubmit(input: unknown): TerminalSubmitMode {
  return isTerminalSubmitMode(input) ? input : DEFAULT_TERMINAL_SUBMIT_MODE;
}

export const DEFAULT_WORKLOG_INTERVAL_HOURS = 6;
const MIN_WORKLOG_INTERVAL_HOURS = 1;
const MAX_WORKLOG_INTERVAL_HOURS = 168; // one week

export function sanitizeWorklogEnabled(input: unknown): boolean {
  return input === true;
}

export function sanitizeIssueWorkComments(input: unknown): boolean {
  return input === true;
}

export function sanitizeCopyOnSelect(input: unknown): boolean {
  return input === true;
}

export function sanitizeDecisionDigest(input: unknown): boolean {
  return input === true;
}

// Inverted against every other boolean here: this one defaults ON, so anything that is not
// an explicit `false` — including a missing key, which is what every existing config file
// has — leaves it enabled.
export function sanitizePrWorkdirFooter(input: unknown): boolean {
  return input !== false;
}

// Same default-ON rule, for the same reason: a missing key must leave every config written
// before #1062 behaving as it did. Its own function rather than an alias of the footer's —
// the planned third value (a user's own wording) widens this one and not that one.
export function sanitizeAppendSystemPrompt(input: unknown): boolean {
  return input !== false;
}

// Positive whole hours, clamped to [1, 168]. Anything else falls back to the default.
export function sanitizeWorklogIntervalHours(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return DEFAULT_WORKLOG_INTERVAL_HOURS;
  return Math.min(MAX_WORKLOG_INTERVAL_HOURS, Math.max(MIN_WORKLOG_INTERVAL_HOURS, Math.round(input)));
}

// Fresh object each call — callers hold and mutate the returned config in place, so a
// shared default constant would be corrupted across loads. Exported so a write path can
// use it as the base for a MISSING file WITHOUT a second disk read (that re-read could
// race a concurrent write turning the file corrupt between the two reads).
export const emptyConfig = (): AppConfig => ({
  cwdPresets: [],
  soundFile: null,
  soundKinds: [...DEFAULT_SOUND_KINDS],
  sounds: {},
  prRepos: [],
  launchers: [],
  quickCommands: [],
  userMcpServers: [],
  themes: [],
  buttons: null,
  chips: null,
  pushEnabled: false,
  pushKinds: [...DEFAULT_PUSH_KINDS],
  worklogEnabled: false,
  worklogIntervalHours: DEFAULT_WORKLOG_INTERVAL_HOURS,
  providers: [],
  terminalSubmit: DEFAULT_TERMINAL_SUBMIT_MODE,
  keymap: {},
  copyOnSelect: false,
  decisionDigest: false,
  issueWorkComments: false,
  prWorkdirFooter: true,
  appendSystemPrompt: true,
  cockpitLines: { ...DEFAULT_COCKPIT_LINES },
  fontFamily: null,
});

// Drop malformed entries rather than rejecting the whole config: one bad provider must
// not cost the user their launchers and presets. A bad entry surfaces at spawn time,
// where resolveProvider names the actual problem.
export function sanitizeProviders(input: unknown): Provider[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    const parsed = providerSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

// Sanitize a parsed config object into an AppConfig. Pure; `raw` is whatever JSON.parse
// produced (any shape), so every field is defended by its own sanitizer.
function sanitizeAppConfig(raw: unknown): AppConfig {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    cwdPresets: sanitizePresets(o.cwdPresets),
    soundFile: sanitizeSoundFile(o.soundFile),
    soundKinds: sanitizeSoundKinds(o.soundKinds),
    sounds: sanitizeSounds(o.sounds),
    prRepos: sanitizeRepos(o.prRepos),
    launchers: sanitizeLaunchers(o.launchers),
    quickCommands: sanitizeQuickCommands(o.quickCommands),
    userMcpServers: sanitizeUserMcpServers(o.userMcpServers),
    themes: sanitizeCustomThemes(o.themes),
    buttons: sanitizeButtons(o.buttons),
    chips: sanitizeChips(o.chips),
    pushEnabled: sanitizePushEnabled(o.pushEnabled),
    pushKinds: sanitizePushKinds(o.pushKinds),
    worklogEnabled: sanitizeWorklogEnabled(o.worklogEnabled),
    worklogIntervalHours: sanitizeWorklogIntervalHours(o.worklogIntervalHours),
    providers: sanitizeProviders(o.providers),
    terminalSubmit: sanitizeTerminalSubmit(o.terminalSubmit),
    keymap: sanitizeKeymap(o.keymap),
    copyOnSelect: sanitizeCopyOnSelect(o.copyOnSelect),
    decisionDigest: sanitizeDecisionDigest(o.decisionDigest),
    issueWorkComments: sanitizeIssueWorkComments(o.issueWorkComments),
    prWorkdirFooter: sanitizePrWorkdirFooter(o.prWorkdirFooter),
    appendSystemPrompt: sanitizeAppendSystemPrompt(o.appendSystemPrompt),
    cockpitLines: sanitizeCockpitLines(o.cockpitLines),
    fontFamily: normalizeFontFamily(o.fontFamily),
  };
}

// The top-level keys this version does not know. Every instance on the machine shares one
// config.json, so a key written by a NEWER version — or left behind by a downgrade — arrives
// here as "unrecognised". Sanitizing drops it, and dropping it is how `copyOnSelect` vanished
// seconds after being set, with no warning anywhere (#966): an unknown key is not an invalid
// value, it is one this build has not learned yet, and the write path has to hand it back.
//
// The known set comes from `emptyConfig()` rather than a second list, because that object is
// typed AppConfig — a field added to the config cannot be missing from it.
export function unknownConfigKeys(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const known = new Set(Object.keys(emptyConfig()));
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
}

// "missing" and "corrupt" are DIFFERENT and a caller about to overwrite must tell them
// apart: an absent file means "first run, start from empty"; an unparseable file means
// "the user has real config here that we simply failed to read", where writing an empty
// base back would silently erase presets/launchers/providers. loadAppConfig collapses
// both to empty (safe for read-only boot); a WRITE path must use this instead.
export type AppConfigLoad =
  { status: "ok"; config: AppConfig; unknownKeys: Record<string, unknown> } | { status: "missing" } | { status: "corrupt"; error: string };

export function loadAppConfigResult(file: string): AppConfigLoad {
  if (!existsSync(file)) return { status: "missing" };
  let text: string;
  try {
    text = readTextFile(file);
  } catch (err) {
    return { status: "corrupt", error: `cannot read ${file}: ${String(err)}` };
  }
  try {
    const raw: unknown = JSON.parse(text);
    return { status: "ok", config: sanitizeAppConfig(raw), unknownKeys: unknownConfigKeys(raw) };
  } catch (err) {
    return { status: "corrupt", error: `invalid JSON in ${file}: ${String(err)}` };
  }
}

// What a writer must carry from its load to its save. A missing or corrupt file has none to
// preserve — the corrupt case never reaches a write at all (the route backs it up and refuses).
export function unknownKeysOf(loaded: AppConfigLoad): Record<string, unknown> {
  return loaded.status === "ok" ? loaded.unknownKeys : {};
}

// Lenient load for read-only / boot callers: a missing OR unreadable file yields an empty
// config so startup never crashes. Callers that then WRITE must NOT use this — see
// loadAppConfigResult, or a corrupt file gets overwritten with the empty base.
export function loadAppConfig(file: string): AppConfig {
  const loaded = loadAppConfigResult(file);
  return loaded.status === "ok" ? loaded.config : emptyConfig();
}

// Copy a corrupt config aside before refusing to overwrite it, so the user's unreadable-
// but-real config isn't lost. Returns the backup path, or null if even the copy failed
// (best-effort — the caller still refuses the write regardless).
export function backupCorruptConfig(file: string): string | null {
  const bak = `${file}.corrupt.bak`;
  try {
    copyFileSync(file, bak);
    return bak;
  } catch {
    return null;
  }
}

// Apply a partial POST /api/config body onto a BASE config: fields the body omits keep
// the base's value. The caller MUST pass a freshly-loaded-from-disk base (not a cached
// in-memory config) — multiple mulmoterminal instances share one config.json, and a
// stale in-memory copy would otherwise write back its boot-time values for the omitted
// fields, clobbering whatever another instance persisted since (e.g. wiping buttons).
export function mergeConfigUpdate(base: AppConfig, body: Record<string, unknown>): AppConfig {
  // `undefined` means "the body didn't mention this field", which is NOT the same as a field
  // sent as null/[] — those are real values the sanitizer decides on.
  const updated = <T>(key: keyof AppConfig, sanitize: (input: unknown) => T, current: T): T => (body[key] !== undefined ? sanitize(body[key]) : current);
  return {
    cwdPresets: updated("cwdPresets", sanitizePresets, base.cwdPresets),
    soundFile: updated("soundFile", sanitizeSoundFile, base.soundFile),
    soundKinds: updated("soundKinds", sanitizeSoundKinds, base.soundKinds),
    sounds: updated("sounds", sanitizeSounds, base.sounds),
    prRepos: updated("prRepos", sanitizeRepos, base.prRepos),
    launchers: updated("launchers", sanitizeLaunchers, base.launchers),
    quickCommands: updated("quickCommands", sanitizeQuickCommands, base.quickCommands),
    userMcpServers: updated("userMcpServers", sanitizeUserMcpServers, base.userMcpServers),
    themes: updated("themes", sanitizeCustomThemes, base.themes),
    buttons: updated("buttons", sanitizeButtons, base.buttons),
    chips: updated("chips", sanitizeChips, base.chips),
    pushEnabled: updated("pushEnabled", sanitizePushEnabled, base.pushEnabled),
    pushKinds: updated("pushKinds", sanitizePushKinds, base.pushKinds),
    worklogEnabled: updated("worklogEnabled", sanitizeWorklogEnabled, base.worklogEnabled),
    worklogIntervalHours: updated("worklogIntervalHours", sanitizeWorklogIntervalHours, base.worklogIntervalHours),
    providers: updated("providers", sanitizeProviders, base.providers),
    terminalSubmit: updated("terminalSubmit", sanitizeTerminalSubmit, base.terminalSubmit),
    keymap: updated("keymap", sanitizeKeymap, base.keymap),
    copyOnSelect: updated("copyOnSelect", sanitizeCopyOnSelect, base.copyOnSelect),
    decisionDigest: updated("decisionDigest", sanitizeDecisionDigest, base.decisionDigest),
    issueWorkComments: updated("issueWorkComments", sanitizeIssueWorkComments, base.issueWorkComments),
    fontFamily: updated("fontFamily", normalizeFontFamily, base.fontFamily),
    prWorkdirFooter: updated("prWorkdirFooter", sanitizePrWorkdirFooter, base.prWorkdirFooter),
    appendSystemPrompt: updated("appendSystemPrompt", sanitizeAppendSystemPrompt, base.appendSystemPrompt),
    cockpitLines: updated("cockpitLines", sanitizeCockpitLines, base.cockpitLines),
  };
}

// The config's serializable shape, shared by the persisted file and the GET/POST
// /api/config response so the two can't drift. Fresh object each call; the key order
// here is the on-disk key order.
export function toPublicAppConfig(config: AppConfig): AppConfig {
  return {
    cwdPresets: config.cwdPresets,
    providers: config.providers,
    soundFile: config.soundFile,
    soundKinds: config.soundKinds,
    sounds: config.sounds,
    prRepos: config.prRepos,
    launchers: config.launchers,
    quickCommands: config.quickCommands,
    userMcpServers: config.userMcpServers,
    themes: config.themes,
    buttons: config.buttons,
    chips: config.chips,
    pushEnabled: config.pushEnabled,
    pushKinds: config.pushKinds,
    worklogEnabled: config.worklogEnabled,
    worklogIntervalHours: config.worklogIntervalHours,
    terminalSubmit: config.terminalSubmit,
    keymap: config.keymap,
    copyOnSelect: config.copyOnSelect,
    decisionDigest: config.decisionDigest,
    issueWorkComments: config.issueWorkComments,
    prWorkdirFooter: config.prWorkdirFooter,
    appendSystemPrompt: config.appendSystemPrompt,
    cockpitLines: config.cockpitLines,
    fontFamily: config.fontFamily,
  };
}

// The exact object written to disk: this version's fields, then the keys it did not recognise,
// appended verbatim (#966). Deliberately NOT what GET /api/config answers — the file is the union
// of every version that shares it, the response is what this build can actually act on.
//
// A known field always wins. Membership is `Object.hasOwn`, not `in`: a config key legitimately
// named `toString` or `constructor` answers `in` through the prototype chain and would be dropped
// as a collision that never happened.
//
// Built with fromEntries rather than `out[key] = value`, because a key named `__proto__` is a
// setter on Object.prototype: assigning would re-parent this object and drop the key from the
// JSON entirely — the very deletion this function exists to prevent. fromEntries defines an own
// property, so the key stays ordinary data.
export function serializableAppConfig(config: AppConfig, unknownKeys: Record<string, unknown>): Record<string, unknown> {
  const known = toPublicAppConfig(config);
  const extras = Object.entries(unknownKeys).filter(([key]) => !Object.hasOwn(known, key));
  return Object.fromEntries([...Object.entries(known), ...extras]);
}

// Persist the whole config; returns false on any write failure so the caller can
// surface it instead of reporting a false success.
//
// `unknownKeys` has no default on purpose: every writer shares config.json with other versions,
// so one that forgets to carry them forward silently deletes another version's settings. Make
// that a type error rather than something to remember — pass `unknownKeysOf(loaded)`.
export function saveAppConfig(file: string, config: AppConfig, unknownKeys: Record<string, unknown>): boolean {
  try {
    // Atomic: this is the file holding every provider, launcher and header button, and a
    // truncated one reads as corrupt on the next boot — i.e. as no configuration at all.
    writeFileAtomicSync(file, JSON.stringify(serializableAppConfig(config, unknownKeys), null, 2));
    return true;
  } catch {
    return false;
  }
}
