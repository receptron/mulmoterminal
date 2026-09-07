import { getCurrentScope, onScopeDispose, ref, type Ref } from "vue";
import { presetLabel, type CwdPreset } from "../components/presets";
import { isManagedWorktreePath, worktreeLabel } from "../../common/worktreePath";
import type { Launcher } from "../components/launchers";
import { isCustomAgent, type CustomAgent } from "../../common/customAgents";
import type { UserMcpServer } from "../components/userMcp";
import type { QuickCommand } from "../../common/quickCommands";
import { isPushKind, type PushKind } from "../../common/pushKinds";
import { DEFAULT_SOUND_KINDS, isNotifyKind, type NotifyKind } from "../../common/notifyKinds";
import { isRecord } from "../../common/isRecord";
import { isUnknownArray } from "../../common/isUnknownArray";
import { readSoundMap, type SoundMap } from "./soundSettings";
import type { SoundConfig } from "./useAttentionSound";
import { DEFAULT_TERMINAL_SUBMIT_MODE, isTerminalSubmitMode } from "../../common/terminalSubmit";
import { setTerminalSubmitMode } from "./terminalSubmitMode";
import { setGlobalFontFamily } from "./terminalFontFamily";
import { setCustomThemes } from "./customThemes";
import { refreshTheme } from "./useTheme";
import { setActiveKeymap } from "./activeKeymap";
import { setCockpitLines } from "./cockpitLines";
import { setHeaderStatusDefaults } from "./headerStatusColors";
import { setCopyOnSelect } from "./copyOnSelect";
import { setQuestionPaneEnabled } from "./questionPane";
import { setIssueWorkComments } from "./issueWorkComments";
import { setShowLoadAverage } from "./showLoadAverage";
import { setPrWorkdirFooter } from "./prWorkdirFooter";
import { setAppendSystemPrompt } from "./appendSystemPrompt";
import { setDecisionDigest } from "./decisionDigest";
import { setWorklogEnabled, setWorklogIntervalHours } from "./worklog";
import { setSessionIdleReapDays } from "./sessionReap";
import { setHeaderConfigSummary } from "./headerConfigSummary";
import { postConfigField } from "./postConfigField";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";
import { configRetryDelayMs } from "./configRetryPolicy";

// Waiting between retry attempts. `setTimeout` rather than anything cancellable: a chain that
// has been superseded checks its generation after the sleep, so an abandoned one costs a timer
// that fires into a `return` and nothing else.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The custom attention-sound file is a SINGLETON ref shared across every
// useAppConfig() caller — the beep player lives in the single view while the
// settings modal can be opened from either view, so a change in one must reach the
// other (each useAppConfig() otherwise has its own local refs).
const soundFile = ref<string | null>(null);

// Whether the server sends a Web Push when a task finishes — a SINGLETON like the
// others so the settings toggle (openable from either view) reflects the saved state.
// The actual sending is server-side; the client only reads/writes this flag.
const pushEnabled = ref(false);

// Which kinds of push the server sends (#850) — SINGLETON like the others.
const pushKinds = ref<PushKind[]>([]);

// Which moments beep, and what each one plays (#873) — SINGLETONS like the others, since the
// beep player lives in the single view while the settings modal opens from either.
const soundKinds = ref<NotifyKind[]>([...DEFAULT_SOUND_KINDS]);
const sounds = ref<SoundMap>({});

/** The sound settings as the player wants them. Module-level rather than a useAppConfig()
 *  field so a one-off notification can read them without building per-call config state. */
export const currentSoundConfig = (): SoundConfig => ({ kinds: soundKinds.value, sounds: sounds.value, soundFile: soundFile.value });

// Adopt the sound settings from a /api/config response. Module-level so loadConfig stays a
// readable list of assignments rather than growing a third ternary per field.
function adoptSoundConfig(c: Record<string, unknown>): void {
  soundFile.value = typeof c.soundFile === "string" ? c.soundFile : null;
  // A config written before #873 has no soundKinds; the defaults keep it beeping exactly as it
  // did rather than going silent on upgrade.
  soundKinds.value = Array.isArray(c.soundKinds) ? c.soundKinds.filter(isNotifyKind) : [...DEFAULT_SOUND_KINDS];
  sounds.value = isRecord(c.sounds) ? readSoundMap(c.sounds) : {};
}

// Cross-repo PR list's repos — also a SINGLETON, so the settings modal (openable from
// either view) and any future reader share one list; a save in one view is seen by the
// other instead of each useAppConfig() keeping a divergent copy.
// The server's home directory, used to shorten paths for display (`formatCwd`). A SINGLETON like
// the settings below, and for a sharper reason: it is only ever written by `loadConfig`, so a
// component that calls useAppConfig() WITHOUT calling loadConfig — which anything outside the two
// views does — held its own copy that stayed null forever, and every path it showed came out
// unshortened. Found by looking at a screenshot of the issue rows' clone menu.
const home = ref<string | null>(null);

// Where the server keeps the worktrees IT created (`<MULMOTERMINAL_HOME>/worktrees`), so this side
// can tell one of ours from a directory that merely looks like one — see `isManagedWorktreePath`.
// A SINGLETON for the same reason as `home`: only `loadConfig` writes it, and a component that
// calls useAppConfig() without loading would otherwise hold a copy that stays null forever.
const worktreesRoot = ref<string | null>(null);
// The workspace SUBTREE the mulmoScript plugin serves stories from (#1933): the id a Canvas card
// carries, and the CANONICAL path to compare a file against. Read, never derived — an id the
// browser re-computed could drift from the one the server registered, and a non-canonical path
// would stop matching the moment the workspace was reached through a symlink.
const storiesRoots = ref<StoriesRootConfig[]>([]);

// The initial /api/config while it is still in flight, so a launch that lands first can wait for
// the root rather than decide without it (Codex on #1543). Null when nothing is loading — then
// there is nothing to wait for. It never rejects and `fetchWithTimeout` bounds it, so a dead
// server delays one chip instead of stalling the queue.
let configLoadInFlight: Promise<unknown> | null = null;

/** Run a config load, publishing it as the in-flight one for the duration — what a preset record
 *  waits on when it needs the worktree root before it can decide.
 *
 *  ONE ATTEMPT, never the retry chain that may follow it (see `loadConfig`). The waiter above is
 *  bounded by `fetchWithTimeout`; publishing a chain that sleeps between attempts would make a
 *  restarting backend hold a chip's recording for half a minute instead of one request. */
async function trackConfigLoad<T>(load: () => Promise<T>): Promise<T> {
  const run = load();
  configLoadInFlight = run;
  try {
    return await run;
  } finally {
    // Only when a LATER load has not already taken the slot: clearing another's would tell a
    // waiter that nothing is coming.
    if (configLoadInFlight === run) configLoadInFlight = null;
  }
}

const prRepos = ref<string[]>([]);

// The hosts declared as self-hosted GitLab (#1332). The browser needs it to know that a
// `gitlab.hogefuga.com/...` row can start work, which is a decision this side makes on its own
// (common/issueStartPlan.ts), and Settings now edits it too.
const gitlabHosts = ref<string[]>([]);

/** The declared hosts, for a reader outside the composable — same shape as `currentSoundConfig`
 *  above, and for the same reason: useAppConfig() builds per-call refs, so calling it from a
 *  render path to read one singleton is waste. Reading `.value` here still tracks the dependency,
 *  so a computed that calls this re-runs when the config lands. */
export const currentGitlabHosts = (): string[] => gitlabHosts.value;

// Which clone each repo's work starts in (#1172) — a SINGLETON for the same reason, and read from
// the CONFIG rather than reconstructed from /api/repo-dirs: that view drops a recording whose
// directory it cannot currently see, so merging a new choice into it would quietly delete the
// choice for a clone that happens to be on an unmounted volume today.
const repoDirs = ref<Record<string, string>>({});

// Cell-launcher commands (shell/codex/…) — SINGLETON so the grid's cell launchers and
// the settings editor (openable from either view) share one list.
const launchers = ref<Launcher[]>([]);

// The user's own ways of starting Claude Code, offered in the Agent Picker (#1414) — a SINGLETON
// like the launchers above, and read-only here: config.json is the only place they can be set.
const customAgents = ref<CustomAgent[]>([]);

// User-added HTTP MCP servers merged into the single-view session's --mcp-config —
// SINGLETON like the others.
const userMcpServers = ref<UserMcpServer[]>([]);

// The phrases the phone offers as chips on a session (#830) — SINGLETON like the others, so
// the settings editor and any future in-app use read one list.
const quickCommands = ref<QuickCommand[]>([]);

// Pre-#163 recent dirs lived in localStorage (the removed useRecentDirs). They are
// imported once into the server-side preset list on load — see migrateLegacyRecents.
const LEGACY_RECENTS_KEY = "recent_dirs_v1";

function readLegacyRecents(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_RECENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === "string" && d.length > 0) : [];
  } catch {
    return [];
  }
}

// The elements of a config list that pass their own guard. Anything else is dropped rather than
// loaded: the list is a set of independent entries, so one bad entry costs only itself.
const listOf = <T>(value: unknown, isEntry: (entry: unknown) => entry is T): T[] => (isUnknownArray(value) ? value.filter(isEntry) : []);

const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
/** A stories root as `/api/config` reports it. `canonical` is the server's RESOLVED spelling of the
 *  same directory — optional because a server older than #1976 does not send it, and a card whose
 *  root has none keeps the identity it had before that change. */
export interface StoriesRootConfig {
  id: string;
  canonical?: string;
  paths: string[];
}

/** The named stories root off the wire: an id plus EVERY spelling of the workspace (the launched
 *  one and the resolved one). Both travel because both reach the Files pane, and the browser's
 *  containment check is lexical (#1934). Anything malformed reads as "no named root". */
function readStoriesRoot(value: unknown): StoriesRootConfig | null {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.paths)) return null;
  const paths = value.paths.filter((path): path is string => typeof path === "string");
  if (paths.length === 0) return null;
  // Omitted rather than set to undefined: exactOptionalPropertyTypes is on. A blank one is dropped
  // for the same reason a blank path is — it names no directory to resolve a card against.
  return { id: value.id, ...(typeof value.canonical === "string" && value.canonical !== "" ? { canonical: value.canonical } : {}), paths };
}

/** Every directory the server serves stories from (#1951). The WORKSPACE is the first entry — the
 *  server registers it first and the browser's default-stories rule needs to know which one it is,
 *  so the order is part of the contract rather than a coincidence. */
function readStoriesRoots(value: unknown): StoriesRootConfig[] {
  if (!Array.isArray(value)) return [];
  return value.map(readStoriesRoot).filter((root): root is StoriesRootConfig => root !== null);
}

const isCwdPreset = (value: unknown): value is CwdPreset => isRecord(value) && typeof value.label === "string" && typeof value.path === "string";
const isQuickCommand = (value: unknown): value is QuickCommand => isRecord(value) && typeof value.label === "string" && typeof value.text === "string";
const isUserMcpServer = (value: unknown): value is UserMcpServer => isRecord(value) && typeof value.id === "string" && typeof value.url === "string";
const isLauncher = (value: unknown): value is Launcher => isRecord(value) && typeof value.label === "string" && typeof value.command === "string";

// The record/remove/migrate preset mutations. Each preset write POSTs the whole array, so
// concurrent record/remove calls (two grid cells launching at once) must not each derive
// `next` from the same stale snapshot — the later POST would clobber the earlier one
// (last-write-wins, dropping a just-launched dir). `serialize` runs the writes in order so
// every mutation reads the freshly-saved list before computing its own.
function createPresetMutations(
  presets: Ref<CwdPreset[]>,
  hasAuthoritativeList: () => boolean,
  recordPresetOnServer: (path: string, label: string) => Promise<boolean>,
  removePresetOnServer: (path: string) => Promise<boolean>,
) {
  let presetWrite: Promise<unknown> = Promise.resolve();
  function serialize(mutate: () => Promise<void>): Promise<void> {
    const run = presetWrite.then(mutate, mutate);
    presetWrite = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // Auto-add the dir the user just launched in, so it becomes a one-click chip, and move it
  // to the FRONT (most-recently-used) on every launch so the list reflects launch order. A
  // re-launched dir keeps its existing (possibly manual) label; a new dir is prepended with
  // its basename. Already at the front → no write. No cap: the user prunes the list with the
  // chip's close button. Called with the server-confirmed (effective) cwd so we only remember dirs that
  // actually ran.
  //
  // A managed worktree is skipped — see `isManagedWorktreePath`. Skipped rather than filtered on
  // read, so an entry a previous version recorded stays exactly where the user left it: the chip's
  // close button is theirs to press, and silently dropping saved config is not this function's
  // call. It also means a worktree already in the list stops being bumped to the front.
  async function recordPreset(path: string | null): Promise<void> {
    if (!path) return;
    // Decided BEFORE the write lock is taken, never while holding it: `loadConfigOnce` ends with
    // `migrateLegacyRecents`, which needs that same lock, so waiting for the load from inside it
    // deadlocks an upgrading user's first load outright — the import and the record both hang
    // (Codex on #1543).
    //
    // A path without the worktree SHAPE cannot be one of ours whatever the root turns out to be, so
    // it never waits — which is what keeps a launch during the initial GET writing immediately, a
    // guarantee of its own (#164). Only a shape-matching path waits, and only while the config
    // carrying the root is actually in flight; `fetchWithTimeout` bounds it.
    if (worktreeLabel(path) !== null && worktreesRoot.value === null) await configLoadInFlight;
    if (isManagedWorktreePath(path, worktreesRoot.value)) return;
    return serialize(async () => {
      if (presets.value[0]?.path === path) return; // already most-recent — nothing to reorder
      // A ONE-ENTRY MUTATION, applied to the list on disk by the server — never a replace-all
      // built from `presets.value`.
      //
      // This is the fix for a data-loss bug, so it is worth being blunt about: `presets.value` is
      // this tab's view, and it is EMPTY until the initial GET lands, empty again if that GET
      // fails, and stale the moment another mulmoterminal (or another tab) saves a directory.
      // Sending it as the whole list deletes the difference from a file every instance shares —
      // and that list is what decides which projects the server serves collections for. On
      // 2026-08-09 a terminal launched during the first GET reduced five saved directories to
      // one, silently.
      //
      // Recording is inherently "add this, keep the rest", so it is expressed that way and the
      // rest is never in this tab's hands. That also keeps #164's guarantee — a launch during the
      // initial GET is recorded immediately, with nothing to wait for.
      await recordPresetOnServer(path, presetLabel(path));
    });
  }

  // Drop one preset (the chip's close button). No-op when the path isn't present.
  function removePreset(path: string): Promise<void> {
    return serialize(async () => {
      // Server-side for the same reason as recordPreset: filtering this tab's copy and sending it
      // back would drop every directory this tab had not seen.
      await removePresetOnServer(path);
    });
  }

  // One-time import of the pre-#163 localStorage recents so upgrading users keep their recent
  // dirs as chips. New paths are prepended (most-recent first) so the last-used dir stays at
  // the front — consistent with the MRU ordering; their basename is the label. The legacy key
  // is cleared on success so a chip the user later deletes can't reappear. Dedup keeps it
  // harmless if it runs twice.
  async function migrateLegacyRecents(): Promise<void> {
    // The list is only consulted to decide what is NEW; the writing below is per entry, so a
    // stale read costs at most a duplicate the server then dedupes by path.
    if (!hasAuthoritativeList()) return;
    const legacy = readLegacyRecents();
    if (!legacy.length) return;
    const known = new Set(presets.value.map((p) => p.path));
    const additions = legacy.filter((path) => !known.has(path));
    let saved = true;
    if (additions.length) {
      await serialize(async () => {
        // ONE ENTRY AT A TIME, like every other preset write. An authoritative GET describes the
        // instant it completed: another mulmoterminal can record a directory before this
        // migration's POST reaches the config lock, and a replace-all built from the list we read
        // BEFORE that would delete it. This migration is purely add-only, so it has no business
        // sending a whole list at all.
        //
        // REVERSED, because each record goes to the FRONT: replaying most-recent-last leaves the
        // legacy order intact ahead of what was already saved.
        for (const path of [...additions].reverse()) {
          // A failure stops the import and KEEPS the localStorage key, so the whole thing is
          // retried on the next load rather than half-migrated and forgotten.
          saved = await recordPresetOnServer(path, presetLabel(path));
          if (!saved) return;
        }
      });
    }
    if (!saved) return; // keep the key so the import retries on the next load
    try {
      localStorage.removeItem(LEGACY_RECENTS_KEY);
    } catch {
      // storage blocked — dedup makes a retry harmless
    }
  }

  return { recordPreset, removePreset, migrateLegacyRecents };
}

// The directory-preset subsystem: savePresets + the mutations above, owning the version
// coordination with loadConfig. `version` is bumped by every local preset write; loadConfig
// captures it (snapshotVersion) before its GET and adoptServerPresets skips the server list
// if it changed meanwhile — else a dir the user launched before the initial /api/config
// resolves would be dropped by the stale GET.
function createPresetManager(presets: Ref<CwdPreset[]>, saving: Ref<boolean>, error: Ref<string | null>) {
  let version = 0;
  // True only once a GET (or our own successful save) has authoritatively populated `presets`.
  //
  // THIS IS THE DIFFERENCE BETWEEN RECORDING A DIRECTORY AND DELETING EVERY OTHER ONE. The save
  // is a REPLACE-ALL POST built from `presets.value`, so writing before the list is known sends
  // the empty default plus the one entry — and the user's whole saved-directory list becomes
  // that single directory, on disk, in a file every mulmoterminal on the machine shares.
  //
  // That happened on 2026-08-09: a terminal launched while the initial GET was still in flight
  // reduced five saved directories to one, and the collections of the other four stopped being
  // served (they are the project list — server/infra/project-root.ts). The same guard exists in
  // useShortcuts for the same reason, on the same kind of file.
  let loaded = false;

  // Persist the directory presets. Posts only cwdPresets — the server keeps the other fields,
  // so this never clobbers them. Returns whether the save succeeded.
  async function savePresets(next: CwdPreset[]): Promise<boolean> {
    saving.value = true;
    error.value = null;
    try {
      const res = await fetchWithTimeout("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwdPresets: next }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const saved: unknown = await res.json();
      presets.value = isRecord(saved) && isUnknownArray(saved.cwdPresets) ? saved.cwdPresets.filter(isCwdPreset) : [];
      // The server has now told us what the list IS, so the next write may build on it.
      loaded = true;
      version++;
      return true;
    } catch {
      error.value = "Couldn't save presets. Check the server and try again.";
      return false;
    } finally {
      saving.value = false;
    }
  }

  const snapshotVersion = (): number => version;
  const adoptServerPresets = (list: unknown, capturedVersion: number): void => {
    if (version !== capturedVersion) return;
    presets.value = isUnknownArray(list) ? list.filter(isCwdPreset) : [];
    loaded = true;
  };

  /** Apply a one-entry change on the SERVER and adopt the list it answers with. The response is
   *  the file's real contents after the change, so this tab ends up agreeing with disk even when
   *  its own copy was empty or stale — which is the point.
   *
   *  A failed call leaves the list exactly as it was: the directory is simply not recorded, and
   *  the next launch tries again. It counts as a local write (`version++`) so a GET already in
   *  flight cannot re-adopt the pre-change list over it (#164). */
  async function mutateOneOnServer(url: string, body: Record<string, string>): Promise<boolean> {
    version++;
    try {
      const res = await fetchWithTimeout(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      const saved: unknown = await res.json();
      if (isRecord(saved) && isUnknownArray(saved.cwdPresets)) {
        presets.value = saved.cwdPresets.filter(isCwdPreset);
        loaded = true;
      }
      error.value = null;
      return true;
    } catch {
      error.value = "Couldn't save presets. Check the server and try again.";
      return false;
    }
  }

  const recordPresetOnServer = (path: string, label: string) => mutateOneOnServer("/api/config/cwd-presets/record", { path, label });
  const removePresetOnServer = (path: string) => mutateOneOnServer("/api/config/cwd-presets/remove", { path });

  return {
    savePresets,
    ...createPresetMutations(presets, () => loaded, recordPresetOnServer, removePresetOnServer),
    snapshotVersion,
    adoptServerPresets,
  };
}

// The single-field savers each persist ONE config field and update its SINGLETON ref, so
// they're module-level (no per-composable state) — useAppConfig just re-exports them.
// Persist just the custom attention sound (a file path, or null to use the chime).
async function saveSound(file: string | null): Promise<boolean> {
  const r = await postConfigField("soundFile", file);
  if (r.ok) soundFile.value = typeof r.value === "string" ? r.value : null;
  return r.ok;
}
// Persist the "send a Web Push on task finish" toggle (partial update).
async function savePushEnabled(on: boolean): Promise<boolean> {
  const r = await postConfigField("pushEnabled", on);
  if (r.ok) pushEnabled.value = r.value === true;
  return r.ok;
}
// Persist the cross-repo PR list's repos (partial update, other fields untouched).
async function savePrRepos(next: string[]): Promise<boolean> {
  const r = await postConfigField("prRepos", next);
  if (r.ok) prRepos.value = stringsOf(r.value);
  return r.ok;
}
// Persist the self-hosted GitLab hosts. The server drops anything that is not a bare hostname, so
// the echo is what lands here rather than what was sent — a rejected entry has to disappear from
// the list, not sit there looking saved.
async function saveGitlabHosts(next: string[]): Promise<boolean> {
  const r = await postConfigField("gitlabHosts", next);
  if (r.ok) gitlabHosts.value = stringsOf(r.value);
  return r.ok;
}

// The settings that are PUSHED into other modules rather than held as refs here. Grouped for the
// same reason as adoptSoundConfig: loadConfig should read as what the config decides, not as the
// plumbing for each decision.
function applyGlobalSettings(c: Record<string, unknown>): void {
  // The Enter-key submit/newline byte mapping, so every terminal's key handler honours it.
  // Unset falls back to the standard binding.
  setTerminalSubmitMode(isTerminalSubmitMode(c.terminalSubmit) ? c.terminalSubmit : DEFAULT_TERMINAL_SUBMIT_MODE);
  // Keyboard shortcuts are opt-in: no `keymap` in config.json leaves this empty and
  // every shortcut stays off.
  setActiveKeymap(c.keymap);
  // Copy-on-select, off unless config.json asks for it — it changes the clipboard with no
  // key pressed, so it must never arrive by default.
  setCopyOnSelect(c.copyOnSelect);
  setQuestionPaneEnabled(c.questionPaneEnabled);
  // Whether a cell may comment on the issue it is working on (#979). Off unless opted in.
  setIssueWorkComments(c.issueWorkComments);
  // Whether the grid header carries this machine's load average (#1786). On unless opted out.
  setShowLoadAverage(c.showLoadAverage);
  // How far the cockpit roster clamps each line. Absent `cockpitLines` keeps 2/2/3.
  setCockpitLines(c.cockpitLines);
  // What a header shows once a status replaces the directory's colour (#1617). The default for
  // every directory; a `.mulmoterminal.json` naming either key outranks it per cell.
  setHeaderStatusDefaults(c.headerStatusColors, c.headerStatusTint);
  // The terminal font stack. Terminals already open re-fit when this lands — a different face
  // means different cell metrics.
  setGlobalFontFamily(c.fontFamily);
  // The user's own colour schemes (#996). Re-applied after loading, because the selected id
  // may name one of these: until the config arrives it resolves to nothing, and the app is
  // painted with the default.
  setCustomThemes(c.themes);
  refreshTheme();
}

// The settings this browser only DISPLAYS — the server is what acts on each of them. They still
// have to be adopted, because Settings shows and writes them; before there were controls, nothing
// on this side had a reason to know their values.
function adoptServerSideSettings(c: Record<string, unknown>): void {
  setHeaderConfigSummary(c);
  setPrWorkdirFooter(c.prWorkdirFooter);
  setAppendSystemPrompt(c.appendSystemPrompt);
  setDecisionDigest(c.decisionDigest);
  setWorklogEnabled(c.worklogEnabled);
  setWorklogIntervalHours(c.worklogIntervalHours);
  setSessionIdleReapDays(c.sessionIdleReapDays);
}

// The user's own lists, adopted together — grouped like the sound and repo fields above.
//
// Each is filtered by the SAME guard its own save path uses. They used to differ: a save
// validated, the load on every page open did not.
function adoptListConfig(c: Record<string, unknown>): void {
  launchers.value = listOf(c.launchers, isLauncher);
  customAgents.value = listOf(c.customAgents, isCustomAgent);
  quickCommands.value = listOf(c.quickCommands, isQuickCommand);
  userMcpServers.value = listOf(c.userMcpServers, isUserMcpServer);
}

// The repo fields, adopted together — like adoptSoundConfig, so loadConfig keeps reading as a list
// of facts rather than growing a ternary per field.
function adoptRepoConfig(c: Record<string, unknown>): void {
  prRepos.value = stringsOf(c.prRepos);
  gitlabHosts.value = stringsOf(c.gitlabHosts);
  repoDirs.value = isRecord(c.repoDirs) ? readRepoDirs(c.repoDirs) : {};
}

// Only string values survive: the map goes straight into a request naming a working directory.
const readRepoDirs = (raw: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  Object.entries(raw).forEach(([repo, dir]) => {
    if (typeof dir === "string") out[repo] = dir;
  });
  return out;
};

// Remember which clone a repo's work starts in. MERGED into what is already saved, never
// replacing it: this is called with one repo's answer, and a whole-map write would drop every
// other repo's choice.
async function saveRepoDir(repo: string, dir: string): Promise<boolean> {
  const r = await postConfigField("repoDirs", { ...repoDirs.value, [repo]: dir });
  if (r.ok) repoDirs.value = isRecord(r.value) ? readRepoDirs(r.value) : repoDirs.value;
  return r.ok;
}
// Persist the cell-launcher commands (partial update).
async function saveLaunchers(next: Launcher[]): Promise<boolean> {
  const r = await postConfigField("launchers", next);
  if (r.ok) launchers.value = Array.isArray(r.value) ? r.value.filter(isLauncher) : [];
  return r.ok;
}
// Persist which kinds of push to send (partial update).
async function savePushKinds(next: PushKind[]): Promise<boolean> {
  const r = await postConfigField("pushKinds", next);
  if (r.ok) pushKinds.value = Array.isArray(r.value) ? r.value.filter(isPushKind) : [];
  return r.ok;
}
// Persist which moments beep (partial update).
async function saveSoundKinds(next: NotifyKind[]): Promise<boolean> {
  const r = await postConfigField("soundKinds", next);
  if (r.ok) soundKinds.value = Array.isArray(r.value) ? r.value.filter(isNotifyKind) : [];
  return r.ok;
}
// Persist the per-kind sounds (partial update). The whole map goes each time — the server
// merges by FIELD, not by key, so sending one kind would drop the others.
async function saveSounds(next: SoundMap): Promise<boolean> {
  const r = await postConfigField("sounds", next);
  if (r.ok) sounds.value = isRecord(r.value) ? readSoundMap(r.value) : {};
  return r.ok;
}
// Persist the phone quick commands (partial update).
async function saveQuickCommands(next: QuickCommand[]): Promise<boolean> {
  const r = await postConfigField("quickCommands", next);
  if (r.ok) quickCommands.value = Array.isArray(r.value) ? r.value.filter(isQuickCommand) : [];
  return r.ok;
}
// Persist the user MCP servers (partial update).
async function saveUserMcpServers(next: UserMcpServer[]): Promise<boolean> {
  const r = await postConfigField("userMcpServers", next);
  if (r.ok) userMcpServers.value = Array.isArray(r.value) ? r.value.filter(isUserMcpServer) : [];
  return r.ok;
}

// The notification-sound settings, as one object: every part is a module-level singleton or
// saver already, and listing all six in the return below is what pushed useAppConfig past its
// line budget without saying anything a reader needed.
const soundSettings = { soundFile, soundKinds, sounds, saveSound, saveSoundKinds, saveSounds };

/** What one config read has to reach that is not module-level state: the per-call refs and the
 *  preset manager's version coordination. Passed in rather than closed over so the read itself can
 *  live out here beside the retry that drives it. */
interface ConfigReaderDeps {
  defaultCwd: Ref<string | null>;
  snapshotVersion: () => number;
  adoptServerPresets: (list: unknown, capturedVersion: number) => void;
  migrateLegacyRecents: () => Promise<void>;
}

/** What one attempt is given: the signal that cancels it when it is no longer wanted, and the
 *  test for whether its answer is still the one to adopt. */
interface ReadAttempt {
  signal: AbortSignal;
  stale: () => boolean;
}

type ConfigRead = (attempt: ReadAttempt) => Promise<boolean>;

/** One attempt at reading the config. `true` when the server ANSWERED, adopted or not; `false`
 *  only when the REQUEST failed (a restarting backend, the dev proxy's 502, a timeout) — the one
 *  kind of failure a retry can fix, so the only one that arms one.
 *
 *  THE SPLIT IS AT THE RESPONSE HEAD, not at the end of the function: everything after a 200 has
 *  arrived is the server's real answer, whether we can parse it, recognise its shape, or finish
 *  adopting it. Asking such a server nine more times returns the same body, so the reload is the
 *  user's move. Keeping one `try` around both halves quietly made a malformed body retryable —
 *  Codex caught exactly that on #1771. */
function createConfigReader({ defaultCwd, snapshotVersion, adoptServerPresets, migrateLegacyRecents }: ConfigReaderDeps): ConfigRead {
  return async function readConfig({ signal, stale }: ReadAttempt): Promise<boolean> {
    const version = snapshotVersion();
    let res: Response;
    try {
      res = await fetchWithTimeout("/api/config", { signal });
    } catch {
      return false; // the request never landed — this is what a retry is for
    }
    if (!res.ok) return false;
    try {
      const body: unknown = await res.json();
      // Asked AFTER the body, because that is the await this attempt can lose the race on: a
      // newer load's answer may already have been adopted while ours was still arriving, and
      // adopting now would put the older config back (Codex on #1771). The abort covers the
      // request itself; this covers a response that had already landed when it fired.
      if (stale()) return true;
      if (!isRecord(body)) return true;
      const c = body;
      defaultCwd.value = typeof c.cwd === "string" ? c.cwd : null;
      home.value = typeof c.home === "string" ? c.home : null;
      worktreesRoot.value = typeof c.worktreesRoot === "string" ? c.worktreesRoot : null;
      storiesRoots.value = readStoriesRoots(c.storiesRoots);
      adoptServerPresets(c.cwdPresets, version);
      adoptSoundConfig(c);
      pushEnabled.value = c.pushEnabled === true;
      pushKinds.value = listOf(c.pushKinds, isPushKind);
      adoptRepoConfig(c);
      adoptListConfig(c);
      applyGlobalSettings(c);
      adoptServerSideSettings(c);
      await migrateLegacyRecents();
    } catch {
      // Unreadable, or an adoption step that failed. The screen keeps whatever it already had —
      // and this still counts as answered, so no retry is armed.
    }
    return true;
  };
}

/**
 * The config read, WITH the retry that makes a failed one temporary.
 *
 * Nothing else re-reads `/api/config`: it runs once, from the shell's `onMounted`, and every saved
 * directory, the workspace chip and a dozen global settings come out of it. So one failed request
 * used to leave the launcher showing no saved directories for as long as the tab stayed open —
 * indistinguishable from a user who has opened none, with nothing on screen saying otherwise. A
 * backend that is merely RESTARTING is what produces it, and in this repo's own dev loop that is
 * routine: Vite keeps serving the page from its own port and answers the proxied `/api` with a 502
 * for the seconds the backend takes to come back (`scripts/dev-server.mjs` restarts it on every
 * save under `server/`).
 *
 * ONE LOADER PER `useAppConfig()` CALL, like the preset manager beside it: the chain state (which
 * generation is current, whether the scope is gone) belongs to the caller that loads, and `stale()`
 * therefore compares against that caller's own generation only. Two live callers do not supersede
 * each other — which is safe for the reason the caution above `useAppConfig` gives: the shell that
 * mounts is the one that loads, and everything else takes the values from it. Give a second caller
 * a `loadConfig` and that stops being true, and a slow attempt of one could adopt over a newer
 * answer of the other, since the module-level singletons have no version guard of their own.
 * (CodeRabbit on #1771 read the old wording here as claiming module-level state.)
 */
function createConfigLoader(loadOnce: ConfigRead, unavailable: Ref<boolean>): () => Promise<void> {
  // Which chain is the current one. A second `load()` — a remount, an HMR update — supersedes the
  // chain the previous one left running, so two of them never race to write the same refs.
  let generation = 0;
  // Set when the scope that started a chain goes away: a grid that unmounted has nothing to fill
  // in, and a chain outliving it would sleep on and write into refs nobody reads.
  let disposed = false;
  // The attempt currently in flight, so being superseded (or disposed) CANCELS it rather than
  // waiting for it to land and be discarded.
  let inFlight: AbortController | null = null;
  const abandonInFlight = () => {
    inFlight?.abort();
    inFlight = null;
  };
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      abandonInFlight();
    });

  /** Arm the next attempt, or `null` when this chain is no longer the one to make it. The check
   *  and the assignment are one synchronous step on purpose: with an await between them a chain
   *  that had just been superseded could publish its controller over the current one, and the
   *  next supersede would then cancel the wrong request. */
  function arm(mine: number): ReadAttempt | null {
    if (mine !== generation || disposed) return null;
    const controller = new AbortController();
    inFlight = controller;
    return { signal: controller.signal, stale: () => mine !== generation || disposed };
  }

  async function attempt(mine: number): Promise<boolean | null> {
    const armed = arm(mine);
    if (!armed) return null; // superseded, or the caller is gone
    const answered = await trackConfigLoad(() => loadOnce(armed));
    if (inFlight?.signal === armed.signal) inFlight = null;
    if (armed.stale()) return null;
    if (answered) unavailable.value = false;
    return answered;
  }

  async function retry(mine: number): Promise<void> {
    for (let round = 0; ; round++) {
      const delay_ms = configRetryDelayMs(round);
      // The server is down rather than restarting. Say so — half a minute of silent retrying ends
      // in the same empty launcher this whole change exists to explain, and the user is the only
      // one left who can do anything about it (CodeRabbit on #1771).
      if (delay_ms === null) {
        unavailable.value = true;
        return;
      }
      await sleep(delay_ms);
      const answered = await attempt(mine);
      if (answered !== false) return; // answered, or this chain is no longer the current one
    }
  }

  /** The FIRST attempt is awaited, so `onMounted(loadConfig)` still means "the config is here" on
   *  a healthy server. The retries are deliberately not: they are a background repair, and a mount
   *  must not block on a server that may never answer. */
  return async function load(): Promise<void> {
    abandonInFlight(); // an earlier chain's request must not land on top of this one
    const mine = ++generation;
    if ((await attempt(mine)) !== false) return;
    void retry(mine);
  };
}

// Server config (default workspace dir, home, directory presets, custom sound)
// shared by both the single view and the grid view so each can open the settings
// modal without duplicating the fetch/save logic.
//
// CAUTION — only SOME of what this returns is shared state. The refs declared module-level
// above (sound, push, repos, launchers, quick commands, MCP) are singletons: any caller reads
// the same value. The four below are NOT — each useAppConfig() call gets its own, and they
// only ever fill in for the caller that also runs `loadConfig`. A component that reads
// `presets` here without loading gets a permanently empty list, which looks exactly like a
// user who has opened no directories. Take them from the shell that loaded them instead.
export function useAppConfig() {
  const defaultCwd = ref<string | null>(null);
  const presets = ref<CwdPreset[]>([]);
  const saving = ref(false);
  const error = ref<string | null>(null);

  const { savePresets, recordPreset, removePreset, migrateLegacyRecents, snapshotVersion, adoptServerPresets } = createPresetManager(presets, saving, error);

  // Whether the config could not be read at all, after the retries gave up — what the launcher
  // shows instead of pretending the user has no saved directories. Per-call like `presets`, and
  // filled in for the caller that loads.
  const configUnavailable = ref(false);
  const loadConfig = createConfigLoader(createConfigReader({ defaultCwd, snapshotVersion, adoptServerPresets, migrateLegacyRecents }), configUnavailable);

  return {
    defaultCwd,
    storiesRoots,
    home,
    presets,
    configUnavailable,
    prRepos,
    gitlabHosts,
    saveGitlabHosts,
    repoDirs,
    saveRepoDir,
    launchers,
    customAgents,
    quickCommands,
    userMcpServers,
    ...soundSettings,
    pushEnabled,
    pushKinds,
    saving,
    error,
    loadConfig,
    savePresets,
    recordPreset,
    removePreset,
    savePushEnabled,
    savePushKinds,
    savePrRepos,
    saveLaunchers,
    saveQuickCommands,
    saveUserMcpServers,
  };
}
