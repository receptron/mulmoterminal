// The app config persisted at ~/.mulmoterminal/config.json: the user's directory
// presets plus an optional custom attention-sound file. Unified read/write so a
// partial update (e.g. just the sound) never clobbers the other field. Extracted
// from config-routes.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { SHOW_LOAD_AVERAGE_DEFAULT, sanitizeShowLoadAverage } from "../../common/showLoadAverage.js";
import { sanitizePresets } from "./cwd-presets.js";
import { sanitizeButtons, sanitizeChips } from "./header-config.js";
import {
  launcherSchema,
  customAgentSchema,
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
import { isCustomAgentId, type CustomAgent } from "../../common/customAgents.js";
import { DEFAULT_PUSH_KINDS, PUSH_KINDS, type PushKind } from "../../common/pushKinds.js";
import { DEFAULT_SOUND_KINDS, NOTIFY_KINDS, type NotifyKind } from "../../common/notifyKinds.js";
import { parsePresetRef } from "../../common/notifySounds.js";
import { MODEL_ID_ALLOWED } from "../../common/modelIds.js";
import { sanitizeKeymap, type Keymap } from "../../common/keymap.js";
import { sanitizeCockpitLines, DEFAULT_COCKPIT_LINES, type CockpitLines } from "../../common/cockpitLines.js";
import { sanitizeToolbarPins } from "../../common/toolbarPins.js";
import {
  sanitizeHeaderStatusColors,
  sanitizeHeaderStatusTint,
  DEFAULT_HEADER_STATUS_TINT,
  type HeaderStatusColors,
  type HeaderStatusTint,
} from "../../common/headerStatusColors.js";
import { normalizeFontFamily } from "../../common/terminalFontFamily.js";
import { readTextFile } from "../infra/read-text-file.js";
import { writeFileAtomicSync } from "../files/atomic-write.js";
import { isRepoEntry } from "../../common/repoEntry.js";
import { sanitizeGitlabHosts } from "../../common/gitlabHosts.js";
import { DEFAULT_WORKLOG_INTERVAL_HOURS, sanitizeWorklogIntervalHours } from "../../common/worklogInterval.js";
import { DEFAULT_REAP_IDLE_DAYS, sanitizeReapIdleDays } from "../../common/sessionReap.js";
import { GUI_SERVER_ID } from "../../common/toolGroups.js";

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
  // Hosts that run a self-hosted GitLab (#1332), e.g. "gitlab.hogefuga.com". A host named here is
  // read with `glab`, exactly as gitlab.com is; nothing else can tell them apart from the URL.
  // Takes effect on the next server start, like `prRepos` does.
  gitlabHosts: string[];
  // Which local clone work on a repo starts in, for the repos the user has chosen one for (#1172).
  // Only the CHOICE is stored: which clones exist at all is derived from `cwdPresets` on every
  // read, so adding a clone needs no second edit and a stale entry cannot invent a directory.
  repoDirs: Record<string, string>;
  // User-defined launch commands offered in the grid cell launcher (label + command).
  launchers: Launcher[];
  // The user's OWN ways of starting Claude Code, offered in the Agent Picker beside Claude /
  // Codex / Antigravity / Shell (#1414). Not a launcher: Claude Code's argv is appended to the
  // entry's command, so the session resumes, reports cost, and reaches the GUI tools like any
  // other Claude cell — see common/customAgents.ts.
  customAgents: CustomAgent[];
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
  // The two built-in scheduled tasks that are otherwise always on: the hourly collection/feed
  // refresh and the hourly Google Calendar sync (#2015). Both default ON — they are existing
  // behaviour, and a workspace with feeds would silently stop updating if the default flipped.
  // Only an explicit `false` turns one off, which is the rule a USER task in `tasks.json`
  // already follows.
  feedRefreshEnabled: boolean;
  calendarSyncEnabled: boolean;
  // Days a tmux session may sit with nobody attached and no output before the server ends it at
  // its next start (#1467). 0 turns the sweep off; the conversation is on disk either way.
  sessionIdleReapDays: number;
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
  // Draw this machine's load average beside the 5h / 7d usage gauges in the grid header (#1786).
  // ON unless explicitly disabled: it answers "may I start another agent right now?", which is a
  // question the grid screen poses and could not answer. A host that keeps no load average
  // (Windows) draws nothing whatever this says.
  showLoadAverage: boolean;
  // Which pinned favourites the toolbar shows without opening Collections (#1984), as
  // `"<kind>:<slug>"` keys in the order they are drawn. Empty by default — the toolbar is
  // unchanged until the user promotes one. The pins themselves live in the workspace file
  // MulmoClaude shares; this only says which of them are worth a permanent button here.
  toolbarPins: string[];
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
  // Offer a session's AskUserQuestion choices as buttons in a right pane (#1679). OFF unless
  // asked for: answering from the pane types into the live terminal dialog, so a user who has
  // not asked for it should not have a pane driving their keyboard. The terminal dialog is
  // unaffected either way — the pane is a second way to answer it, never a replacement.
  //
  // The PANE only. The phone answers the same questions whatever this says (mulmoserver#182):
  // there, nobody is at the keyboard the pane would be competing with.
  questionPaneEnabled: boolean;
  // Pick up a project's own favicon when its `.mulmoterminal.json` names no `icon` (#1428).
  // ON unless turned off, unlike the opt-in flags above: it shows a picture the repository
  // already ships rather than creating anything, and a project that doesn't want one says
  // `"icon": false` in its own file. This is the switch for turning the whole behaviour off.
  autoDirIcon: boolean;
  // What a cell header shows once a status replaces the directory's colour — working / done /
  // blocked (#1617). The DEFAULT for every directory; a `.mulmoterminal.json` that names either
  // key outranks it. Global rather than per-directory-only because the readable pairing of a
  // status wash and its ink is a property of the THEME the user runs, not of one project.
  headerStatusColors: HeaderStatusColors;
  headerStatusTint: HeaderStatusTint;
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
// A user entry named like the built-in GUI MCP server is KEPT, not dropped. Dropping it was the
// obvious implementation and it destroys data: the sanitized config is what gets written back on
// the next save, so a user whose own server happened to be called `mt` would lose the entry from
// their config file for good, having changed some unrelated setting. `mt` is short enough to be a
// name someone had already chosen (Codex review on #1355), and it was a legal id before this
// release. Their entry survives; the collision is settled at spawn instead, where mcpConfigJson
// writes the built-in last and so overwrites the clashing key.
//
// Exactly ONE id is in that position, and it is deliberately not the LEGACY list: mcpConfigJson
// writes `GUI_SERVER_ID` and nothing else, so a user server still called `mulmoterminal-gui` is
// reachable and works. Warning about it would be telling someone to rename a server that is fine
// (Codex review, second pass). The legacy ids remain meaningful only where we still WRITE them —
// the Antigravity config merge.
export function sanitizeUserMcpServers(input: unknown): UserMcpServer[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: UserMcpServer[] = [];
  for (const v of input) {
    const parsed = userMcpServerSchema.safeParse(v);
    if (!parsed.success) continue;
    const id = parsed.data.id.trim();
    const url = parsed.data.url.trim();
    if (!MCP_ID_RE.test(id) || !MCP_URL_RE.test(url) || seen.has(id)) continue;
    // Said out loud because this is the one entry that is well-formed and still will not work: the
    // built-in overwrites it at spawn, so without a line in the log the symptom is a server that is
    // present in the config and absent in the session. The rejections above are visibly malformed
    // and stay silent.
    if (id === GUI_SERVER_ID) {
      console.warn(
        `[mcp] userMcpServers: "${id}" is MulmoTerminal's own GUI MCP server id, so that entry is unreachable — the built-in wins. Rename it to use it.`,
      );
    }
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

const CUSTOM_AGENT_LABEL_MAX = 24;
const CUSTOM_AGENT_COMMAND_MAX = 500;
const CUSTOM_AGENTS_MAX = 8;

// Same shape of rule as sanitizeLaunchers, with the ID as the identity rather than the label:
// the id is what a running session is remembered by and what the browser sends back, so a
// duplicate would make two entries indistinguishable on the wire while both still rendered.
//
// An id that is a BUILT-IN picker option ("claude", "shell", …) is dropped by `isCustomAgentId`
// rather than kept: its button would be shadowed by the built-in one, which looks exactly like
// the entry having been ignored.
//
// The label is short because it sits in the same one-line toggle as Claude / Codex /
// Antigravity / Shell, and that row already wraps in a narrow cell.
export function sanitizeCustomAgents(input: unknown): CustomAgent[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: CustomAgent[] = [];
  for (const v of input) {
    const parsed = customAgentSchema.safeParse(v);
    if (!parsed.success) continue;
    const id = parsed.data.id.trim();
    const label = parsed.data.label.trim().slice(0, CUSTOM_AGENT_LABEL_MAX);
    const command = parsed.data.command.trim().slice(0, CUSTOM_AGENT_COMMAND_MAX);
    if (!isCustomAgentId(id) || !label || !command || seen.has(id)) continue;
    seen.add(id);
    // `agent` is already narrowed by the schema's enum — an entry that omits it, or names an
    // agent whose argv this app cannot build, never reaches here. That is deliberate: without it
    // nothing knows WHICH arguments to append, and appending none would start a bare wrapper.
    out.push({ id, label, agent: parsed.data.agent, command });
    if (out.length >= CUSTOM_AGENTS_MAX) break;
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

// `owner/repo`, or `host/owner/repo` for a repository that is not on GitHub — GitLab nests groups,
// so the tail can be longer than two segments (#981).
//
// What may be STORED is `isRepoEntry` in common/, the same rule the two issue-start endpoints and
// the Settings field apply. It was written out four times, and widening only this one meant an
// entry the user could save was rejected by everything downstream — including the form meant to
// accept it (#981).

export function sanitizeRepos(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string") continue;
    const r = v.trim();
    if (isRepoEntry(r)) seen.add(r);
  }
  return [...seen];
}

// Which local clone a repo's work starts in (#1172), for the repos where the user has chosen.
// Absolute paths only, for the same reason as the presets: a relative one would be resolved
// against the server's own cwd and name a directory nobody picked. The path is NOT checked for
// existence here — a clone on an unmounted volume must survive a config round trip, and the read
// side drops a recording that no longer names a clone of that repo anyway.
export function sanitizeRepoDirs(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};
  const out: Record<string, string> = {};
  for (const [repo, dir] of Object.entries(input)) {
    if (!isRepoEntry(repo.trim()) || typeof dir !== "string") continue;
    const resolved = dir.trim();
    if (path.isAbsolute(resolved)) out[repo.trim()] = resolved;
  }
  return out;
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

export function sanitizeWorklogEnabled(input: unknown): boolean {
  return input === true;
}

// `!== false`, not `=== true`: these two are ON unless the user says otherwise, so an absent key
// (every existing config) keeps the behaviour it has today. Same rule as `enabled` on a user task.
export function sanitizeFeedRefreshEnabled(input: unknown): boolean {
  return input !== false;
}

export function sanitizeCalendarSyncEnabled(input: unknown): boolean {
  return input !== false;
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

export function sanitizeQuestionPaneEnabled(input: unknown): boolean {
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

export function sanitizeAutoDirIcon(input: unknown): boolean {
  return input !== false;
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
  gitlabHosts: [],
  repoDirs: {},
  launchers: [],
  customAgents: [],
  quickCommands: [],
  userMcpServers: [],
  headerStatusColors: {},
  headerStatusTint: DEFAULT_HEADER_STATUS_TINT,
  themes: [],
  buttons: null,
  chips: null,
  pushEnabled: false,
  pushKinds: [...DEFAULT_PUSH_KINDS],
  worklogEnabled: false,
  feedRefreshEnabled: true,
  calendarSyncEnabled: true,
  worklogIntervalHours: DEFAULT_WORKLOG_INTERVAL_HOURS,
  sessionIdleReapDays: DEFAULT_REAP_IDLE_DAYS,
  providers: [],
  terminalSubmit: DEFAULT_TERMINAL_SUBMIT_MODE,
  keymap: {},
  copyOnSelect: false,
  decisionDigest: false,
  questionPaneEnabled: false,
  issueWorkComments: false,
  prWorkdirFooter: true,
  appendSystemPrompt: true,
  autoDirIcon: true,
  showLoadAverage: SHOW_LOAD_AVERAGE_DEFAULT,
  toolbarPins: [],
  cockpitLines: { ...DEFAULT_COCKPIT_LINES },
  fontFamily: null,
});

// Said once per process: this config is re-read on paths that run per session spawn, so an entry
// the user has not fixed yet would repeat its line at every launch and bury everything else.
const warnedConfigLines = new Set<string>();
const warnOnce = (message: string): void => {
  if (warnedConfigLines.has(message)) return;
  warnedConfigLines.add(message);
  console.warn(message);
};

// What a rejected entry is quoted as. A dropped value is whatever the user's JSON held — an
// object, or a string far past MODEL_ID_MAX_LENGTH, which is one of the reasons it was rejected —
// so it is quoted to a bound rather than echoed whole into the line.
const DROPPED_MODEL_QUOTE_MAX = 80;
const quoteDropped = (model: unknown): string => {
  const text = JSON.stringify(model) ?? String(model);
  return text.length > DROPPED_MODEL_QUOTE_MAX ? `${text.slice(0, DROPPED_MODEL_QUOTE_MAX)}…` : text;
};

// A model id the schema refuses is dropped in silence, and a provider whose whole list was
// refused looks exactly like one that never listed any: the picker has nothing to offer while the
// user is reading a config file that lists models (#1432). Compared against what the schema KEPT
// rather than re-testing the rule here, so the two cannot drift apart.
function warnDroppedModels(provider: Provider, raw: unknown): void {
  if (!isRecord(raw) || raw.models === undefined) return;
  if (!Array.isArray(raw.models)) {
    warnOnce(`[providers] '${provider.id}': "models" must be an array of model ids — the whole value was ignored, so this backend offers nothing.`);
    return;
  }
  const kept = new Set(provider.models);
  const dropped = raw.models.filter((model) => typeof model !== "string" || !kept.has(model.trim()));
  if (dropped.length === 0) return;
  const shown = dropped.map(quoteDropped).join(", ");
  warnOnce(`[providers] '${provider.id}': dropped ${dropped.length} unusable model id(s) — ${shown}. A model id is ${MODEL_ID_ALLOWED}.`);
}

// Drop malformed entries rather than rejecting the whole config: one bad provider must
// not cost the user their launchers and presets. A bad entry surfaces at spawn time,
// where resolveProvider names the actual problem.
export function sanitizeProviders(input: unknown): Provider[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((entry) => {
    const parsed = providerSchema.safeParse(entry);
    if (!parsed.success) return [];
    warnDroppedModels(parsed.data, entry);
    return [parsed.data];
  });
}

// Sanitize a parsed config object into an AppConfig. Pure; `raw` is whatever JSON.parse
// produced (any shape), so every field is defended by its own sanitizer.
function sanitizeAppConfig(raw: unknown): AppConfig {
  const o: Record<string, unknown> = isRecord(raw) ? raw : {};
  return {
    cwdPresets: sanitizePresets(o.cwdPresets),
    soundFile: sanitizeSoundFile(o.soundFile),
    soundKinds: sanitizeSoundKinds(o.soundKinds),
    sounds: sanitizeSounds(o.sounds),
    prRepos: sanitizeRepos(o.prRepos),
    gitlabHosts: sanitizeGitlabHosts(o.gitlabHosts),
    repoDirs: sanitizeRepoDirs(o.repoDirs),
    launchers: sanitizeLaunchers(o.launchers),
    customAgents: sanitizeCustomAgents(o.customAgents),
    quickCommands: sanitizeQuickCommands(o.quickCommands),
    userMcpServers: sanitizeUserMcpServers(o.userMcpServers),
    headerStatusColors: sanitizeHeaderStatusColors(o.headerStatusColors),
    headerStatusTint: sanitizeHeaderStatusTint(o.headerStatusTint) ?? DEFAULT_HEADER_STATUS_TINT,
    themes: sanitizeCustomThemes(o.themes),
    buttons: sanitizeButtons(o.buttons),
    chips: sanitizeChips(o.chips),
    pushEnabled: sanitizePushEnabled(o.pushEnabled),
    pushKinds: sanitizePushKinds(o.pushKinds),
    worklogEnabled: sanitizeWorklogEnabled(o.worklogEnabled),
    feedRefreshEnabled: sanitizeFeedRefreshEnabled(o.feedRefreshEnabled),
    calendarSyncEnabled: sanitizeCalendarSyncEnabled(o.calendarSyncEnabled),
    worklogIntervalHours: sanitizeWorklogIntervalHours(o.worklogIntervalHours),
    sessionIdleReapDays: sanitizeReapIdleDays(o.sessionIdleReapDays),
    providers: sanitizeProviders(o.providers),
    terminalSubmit: sanitizeTerminalSubmit(o.terminalSubmit),
    keymap: sanitizeKeymap(o.keymap),
    copyOnSelect: sanitizeCopyOnSelect(o.copyOnSelect),
    decisionDigest: sanitizeDecisionDigest(o.decisionDigest),
    questionPaneEnabled: sanitizeQuestionPaneEnabled(o.questionPaneEnabled),
    issueWorkComments: sanitizeIssueWorkComments(o.issueWorkComments),
    prWorkdirFooter: sanitizePrWorkdirFooter(o.prWorkdirFooter),
    appendSystemPrompt: sanitizeAppendSystemPrompt(o.appendSystemPrompt),
    autoDirIcon: sanitizeAutoDirIcon(o.autoDirIcon),
    showLoadAverage: sanitizeShowLoadAverage(o.showLoadAverage),
    toolbarPins: sanitizeToolbarPins(o.toolbarPins),
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
    gitlabHosts: updated("gitlabHosts", sanitizeGitlabHosts, base.gitlabHosts),
    repoDirs: updated("repoDirs", sanitizeRepoDirs, base.repoDirs),
    launchers: updated("launchers", sanitizeLaunchers, base.launchers),
    customAgents: updated("customAgents", sanitizeCustomAgents, base.customAgents),
    quickCommands: updated("quickCommands", sanitizeQuickCommands, base.quickCommands),
    userMcpServers: updated("userMcpServers", sanitizeUserMcpServers, base.userMcpServers),
    headerStatusColors: updated("headerStatusColors", sanitizeHeaderStatusColors, base.headerStatusColors),
    headerStatusTint: updated("headerStatusTint", (input) => sanitizeHeaderStatusTint(input) ?? DEFAULT_HEADER_STATUS_TINT, base.headerStatusTint),
    themes: updated("themes", sanitizeCustomThemes, base.themes),
    buttons: updated("buttons", sanitizeButtons, base.buttons),
    chips: updated("chips", sanitizeChips, base.chips),
    pushEnabled: updated("pushEnabled", sanitizePushEnabled, base.pushEnabled),
    pushKinds: updated("pushKinds", sanitizePushKinds, base.pushKinds),
    worklogEnabled: updated("worklogEnabled", sanitizeWorklogEnabled, base.worklogEnabled),
    feedRefreshEnabled: updated("feedRefreshEnabled", sanitizeFeedRefreshEnabled, base.feedRefreshEnabled),
    calendarSyncEnabled: updated("calendarSyncEnabled", sanitizeCalendarSyncEnabled, base.calendarSyncEnabled),
    worklogIntervalHours: updated("worklogIntervalHours", sanitizeWorklogIntervalHours, base.worklogIntervalHours),
    sessionIdleReapDays: updated("sessionIdleReapDays", sanitizeReapIdleDays, base.sessionIdleReapDays),
    providers: updated("providers", sanitizeProviders, base.providers),
    terminalSubmit: updated("terminalSubmit", sanitizeTerminalSubmit, base.terminalSubmit),
    keymap: updated("keymap", sanitizeKeymap, base.keymap),
    copyOnSelect: updated("copyOnSelect", sanitizeCopyOnSelect, base.copyOnSelect),
    decisionDigest: updated("decisionDigest", sanitizeDecisionDigest, base.decisionDigest),
    questionPaneEnabled: updated("questionPaneEnabled", sanitizeQuestionPaneEnabled, base.questionPaneEnabled),
    issueWorkComments: updated("issueWorkComments", sanitizeIssueWorkComments, base.issueWorkComments),
    fontFamily: updated("fontFamily", normalizeFontFamily, base.fontFamily),
    prWorkdirFooter: updated("prWorkdirFooter", sanitizePrWorkdirFooter, base.prWorkdirFooter),
    appendSystemPrompt: updated("appendSystemPrompt", sanitizeAppendSystemPrompt, base.appendSystemPrompt),
    autoDirIcon: updated("autoDirIcon", sanitizeAutoDirIcon, base.autoDirIcon),
    showLoadAverage: updated("showLoadAverage", sanitizeShowLoadAverage, base.showLoadAverage),
    toolbarPins: updated("toolbarPins", sanitizeToolbarPins, base.toolbarPins),
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
    gitlabHosts: config.gitlabHosts,
    repoDirs: config.repoDirs,
    launchers: config.launchers,
    customAgents: config.customAgents,
    quickCommands: config.quickCommands,
    userMcpServers: config.userMcpServers,
    headerStatusColors: config.headerStatusColors,
    headerStatusTint: config.headerStatusTint,
    themes: config.themes,
    buttons: config.buttons,
    chips: config.chips,
    pushEnabled: config.pushEnabled,
    pushKinds: config.pushKinds,
    worklogEnabled: config.worklogEnabled,
    feedRefreshEnabled: config.feedRefreshEnabled,
    calendarSyncEnabled: config.calendarSyncEnabled,
    worklogIntervalHours: config.worklogIntervalHours,
    sessionIdleReapDays: config.sessionIdleReapDays,
    terminalSubmit: config.terminalSubmit,
    keymap: config.keymap,
    copyOnSelect: config.copyOnSelect,
    decisionDigest: config.decisionDigest,
    questionPaneEnabled: config.questionPaneEnabled,
    issueWorkComments: config.issueWorkComments,
    prWorkdirFooter: config.prWorkdirFooter,
    appendSystemPrompt: config.appendSystemPrompt,
    autoDirIcon: config.autoDirIcon,
    showLoadAverage: config.showLoadAverage,
    toolbarPins: config.toolbarPins,
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
