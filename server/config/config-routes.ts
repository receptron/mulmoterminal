// GET/POST /api/config — the default workspace dir, the user's directory presets,
// and an optional custom attention-sound file (persisted at ~/.mulmoterminal/
// config.json), shown/edited in the UI. GET /api/sound streams that sound file, and
// GET /api/sound-preset/:id streams one of the built-in preset sounds.
// Kept in its own module (mounted from index.ts) so grid/preset work doesn't churn
// index.ts and collide with unrelated server changes.
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Express, Request, Response } from "express";
import { MAX_PALETTE_FAVORITES, MAX_PALETTE_KEY_CHARS } from "../../common/paletteConfig.js";
import { isPresetChangeList, KEYMAP_PRESETS, presetChanges, reservedBindings, withPreset } from "../../common/keymapPresets.js";
import {
  loadAppConfig,
  loadAppConfigResult,
  backupCorruptConfig,
  emptyConfig,
  saveAppConfig,
  mergeConfigUpdate,
  toPublicAppConfig,
  unknownKeysOf,
  type AppConfig,
} from "./app-config.js";
import { ARGV_DEFAULT_AGENT } from "./env.js";
import type { TerminalAgent } from "../../common/sessionAgent.js";
import { type HeaderConfig } from "./header/header-config.js";
import { type CwdPreset, type Launcher, type Provider, type UserMcpServer } from "./config-schema.js";
import type { QuickCommand } from "../../common/quickCommands.js";
import type { CustomAgent } from "../../common/customAgents.js";
import type { AgentAccount } from "../../common/agentAccounts.js";
import type { PlayfulEffects } from "../../common/playfulEffects.js";
import { systemTaskSettingsChanged } from "./system-task-settings.js";
import { setAccountsProvider } from "../session/session-home.js";
import { setTmuxPrefix } from "../infra/process/tmux.js";
import type { TokenRotation } from "../../common/tokenRotation.js";
import { installBundledSkills } from "../infra/fs/install-bundled-skills.js";
import type { SystemTaskSwitches } from "../backends/scheduler/system-tasks.js";
import type { PushKind } from "../../common/pushKinds.js";
import { type TerminalSubmitMode } from "../../common/terminalSubmit.js";
import { launchOptions } from "./launch-options.js";
import { worktreesRootDir } from "./worktree/worktree-task.js";
import { canonicalPath } from "../infra/fs/canonical-path.js";
import { registeredStoriesRoots } from "../backends/plugins/mulmoscript.js";
import { badArrayField, badNullableArrayField, badObjectField } from "./config-body.js";
import { setDeclaredGitlabHosts } from "../git/forge-host.js";
import { getUpdateStatus } from "./update-status.js";
import { readSoundPreset } from "./sound-presets.js";
import { isNotifyKind } from "../../common/notifyKinds.js";
import { parsePresetRef, soundPresetById } from "../../common/notifySounds.js";
import { requestBody } from "../routes/requestBody.js";
import { mountAgentEntryRoutes, type OnDiskChange } from "./agent/agent-entry-routes.js";
import { mountThemeEntryRoutes } from "./theme-entry-routes.js";
import { mountHeaderChipRoutes } from "./header/header-chip-routes.js";
import { mountHeaderButtonRoutes } from "./header/header-button-routes.js";
import { withConfigLock, ConfigLockTimeout } from "./config-lock.js";
import { mountConfigReloadRoute } from "./config-reload.js";
import { mountKeymapBindingRoute } from "./keymap/keymap-binding-route.js";
import { lastSegment } from "../../common/pathSegments.js";

export const APP_CONFIG_FILE = path.join(os.homedir(), ".mulmoterminal", "config.json");
const CONFIG_FILE = APP_CONFIG_FILE;
let config: AppConfig = loadAppConfig(CONFIG_FILE);
// Before anything asks whether tmux is there: that first answer writes the conf file this feeds.
setTmuxPrefix(config.tmuxPrefix);

// The repos the cross-repo PR view aggregates — read live so a POST /api/config that
// changes them takes effect on the next /api/prs without a restart.
export function getPrRepos(): string[] {
  return config.prRepos;
}

// The hosts declared as self-hosted GitLab (#1332) — read live, like the repos above, so a POST
// that changes them reaches the next `glab` call without a restart. A hand edit of config.json
// still needs one, exactly as `prRepos` does.
export function getGitlabHosts(): string[] {
  return config.gitlabHosts;
}

// Wired here rather than in mountConfigRoutes: the forge layer answers "which CLI reads this host"
// for git status polls and header context too, not only for mounted routes, and this module is
// already loaded at import time by everything that reads the config. The edge runs config -> git
// on purpose — forge-host must not import this module back (see setDeclaredGitlabHosts).
setDeclaredGitlabHosts(getGitlabHosts);

// The saved directories and the recorded clone-per-repo choices, for the repo -> dir reverse
// lookup (#1172). Read live for the same reason as the repos above: choosing a clone writes the
// config, and the next lookup has to see it without a restart.
/** Whether the saved-directory list is the same one. By PATH: a relabelled preset is the same
 *  directory to everything downstream of this (the collection watchers, the project ids), and
 *  waking them for a rename would be work with no question behind it. */
function samePresets(before: readonly CwdPreset[], after: readonly CwdPreset[]): boolean {
  if (before.length !== after.length) return false;
  return before.every((preset, index) => preset.path === after[index]?.path);
}

export function getCwdPresets(): CwdPreset[] {
  return config.cwdPresets;
}

export function getRepoDirs(): Record<string, string> {
  return config.repoDirs;
}

// The launch commands a grid cell offers — read live so /ws/launch resolves a launcher
// index against the current list without a restart.
export function getLaunchers(): Launcher[] {
  return config.launchers;
}

// The user's own ways of starting Claude Code, offered in the Agent Picker — read live for the
// same reason as the launchers above: /ws resolves `?customAgent=<id>` against the current list,
// so adding one needs no restart. The LIST is the allowlist; the browser sends only an id.
export function getCustomAgents(): CustomAgent[] {
  return config.customAgents;
}

// Second logins for claude / codex (#2215). Read live like the custom agents: a new session is
// bound against the current list, so adding an account needs no restart.
export function getAccounts(): AgentAccount[] {
  return config.accounts;
}

// Read live: each new session is assigned a token from the current list (#2919).
export function getTokenRotation(): TokenRotation {
  return config.tokenRotation;
}

export function getPlayfulEffects(): PlayfulEffects {
  return config.playfulEffects;
}
setAccountsProvider(getAccounts);

// The phrases the phone offers as chips — read live so a Settings edit reaches the next
// screen the phone pulls without a restart (#830).
export function getQuickCommands(): QuickCommand[] {
  return config.quickCommands;
}

// User-added HTTP MCP servers — read live so a config change is picked up by the next
// Claude spawn without a restart.
export function getUserMcpServers(): UserMcpServer[] {
  return config.userMcpServers;
}

// The configured Anthropic-compatible backends, read live so a config edit applies to the
// next session without a restart (#579).
export function getProviders(): Provider[] {
  return config.providers;
}

// The ids of the user's own colour schemes (#996), read live like the providers above. A
// directory may pin one in its `.mulmoterminal.json`, and the dir loader needs to know which
// names resolve — an id matching neither a built-in nor one of these is a typo, and is dropped
// so it shows up in Settings' Directory settings instead of silently painting the default.
export function getCustomThemeIds(): string[] {
  return config.themes.map((theme) => theme.id);
}

// The global terminal-header buttons/chips — read live so /api/header reflects a config
// change on the next fetch without a restart.
export function getHeaderConfig(): HeaderConfig {
  return { buttons: config.buttons, chips: config.chips, commands: config.commands };
}

// Whether to send a Web Push when a task finishes — read live at the Stop hook so a
// settings toggle takes effect without a restart.
// Whether the user opted in to MulmoTerminal writing on their issues (#979). Read live, like the
// rest: turning it off must stop the next comment, not the next restart.
export function getIssueWorkComments(): boolean {
  return config.issueWorkComments;
}

// Whether a project with no `icon` of its own may show the favicon it already ships (#1428).
// Read live for the same reason as the rest — turning it off recolours the next request, not
// the next restart.
export function getAutoDirIcon(): boolean {
  return config.autoDirIcon;
}

export function getPushEnabled(): boolean {
  return config.pushEnabled;
}

// Read live so toggling the setting takes effect on the next timer tick, without a restart.
export function getDecisionDigestEnabled(): boolean {
  return config.decisionDigest;
}

// Which kinds of push the user wants (#850). Read live so unticking one in Settings takes
// effect on the very next hook, without a restart.
export function getPushKinds(): PushKind[] {
  return config.pushKinds;
}

// The periodic dev-work-log settings. Off by default. Read whenever the system tasks are built:
// at boot, and again when a save moves one of them (onSystemTaskSettingsChanged below).
export function getWorklogConfig(): { enabled: boolean; intervalHours: number } {
  return { enabled: config.worklogEnabled, intervalHours: config.worklogIntervalHours };
}

// Which built-in system tasks to register (#2015). Read at the same moments as the worklog above.
export function getSystemTaskSwitches(): SystemTaskSwitches {
  return { feedRefresh: config.feedRefreshEnabled, calendarSync: config.calendarSyncEnabled };
}

// Told when a save moves a setting the system tasks are built from, so the scheduler rebuilds them
// without a restart (#2626). One listener: the scheduler is the only thing that registers them.
let systemTaskSettingsListener: (() => void) | null = null;
export function onSystemTaskSettingsChanged(listener: () => void): void {
  systemTaskSettingsListener = listener;
}

// The subscribers a save may concern, told only when what they depend on moved. Both compare against
// the in-memory config, which is what the directories served and the scheduler running were built from.
function notifySavedChanges(previous: AppConfig, next: AppConfig, onCwdPresetsChanged?: CwdPresetsChanged): void {
  if (!samePresets(previous.cwdPresets, next.cwdPresets)) notifyPresetsChanged(onCwdPresetsChanged);
  if (systemTaskSettingsChanged(previous, next)) notifySystemTaskSettingsChanged();
  if (previous.tmuxPrefix !== next.tmuxPrefix) setTmuxPrefix(next.tmuxPrefix);
  if (previous.sessionReapIntervalHours !== next.sessionReapIntervalHours) notifyReapIntervalChanged(next.sessionReapIntervalHours);
}

function notifyReapIntervalChanged(hours: number): void {
  try {
    reapIntervalListener?.(hours);
  } catch (err) {
    console.error("[tmux] re-arming the idle-session sweep failed", err);
  }
}

function mountReload(app: Express, configResponse: () => unknown, onCwdPresetsChanged?: CwdPresetsChanged): void {
  mountConfigReloadRoute(app, {
    file: CONFIG_FILE,
    adopt: (next) => adoptReloaded(next, onCwdPresetsChanged),
    respond: (res) => res.json(configResponse()),
    lockFailure: answerLockFailure,
  });
}

// A config read back from disk (#2627) is adopted the way a save is: the same subscribers are told
// about what moved, and a new account gets the bundled skills in its home.
function adoptReloaded(next: AppConfig, onCwdPresetsChanged?: CwdPresetsChanged): void {
  const previous = config;
  config = next;
  if (JSON.stringify(previous.accounts) !== JSON.stringify(next.accounts)) installBundledSkills();
  notifySavedChanges(previous, next, onCwdPresetsChanged);
}

// Fire-and-forget by contract, like notifyPresetsChanged: the save already succeeded, and a
// scheduler that fails to rebuild must not turn it into a 500.
function notifySystemTaskSettingsChanged(): void {
  try {
    systemTaskSettingsListener?.();
  } catch (err) {
    console.error("[scheduler] rebuilding the system tasks failed", err);
  }
}

// How long a session may sit unused before a sweep ends it (#1467). Read live, and LIVE IS THE
// POINT: `startReapSchedule` takes this as a function and calls it on every tick, so a POST reaches
// the running server at once — including `0`, which stops an already-armed timer from ending
// anything. That is the opposite of the cadence getter below, and the pair is the asymmetry the
// Settings copy rests on: the threshold may be described in the present tense, the cadence may not.
export function getSessionIdleReapDays(): number {
  return config.sessionIdleReapDays;
}

// How often the sweep runs again while we are up (#2165). Read at the start that arms the timer, and
// passed on when a save moves it (#2626), which re-arms counted from the last sweep. What this process
// actually armed is reported by session/reaping/reap-schedule.ts rather than inferred from this number.
export function getSessionReapIntervalHours(): number {
  return config.sessionReapIntervalHours;
}

// Told the new cadence when a save or a reload moves it. One listener: the sweep is armed in one place.
let reapIntervalListener: ((hours: number) => void) | null = null;
export function onSessionReapIntervalChanged(listener: (hours: number) => void): void {
  reapIntervalListener = listener;
}

// The Enter-key submit/newline byte mapping — read live so the phone remote-view submit
// picks up a config edit on the next send without a restart (#772).
export function getTerminalSubmit(): TerminalSubmitMode {
  return config.terminalSubmit;
}

// Whether a PR this app creates says which clone it came from (#872).
//
// Read from DISK, unlike every other accessor here. The in-memory copy is refreshed only by a
// POST to THIS server, and these two settings are read by the instance the user is not looking
// at: several mulmoterminals share one config.json, and this is the app whose whole point is
// running side-by-side clones. Served from memory, a user who turns the line off in one window
// still gets it from the next window's PR — and both settings fail silently, so what they see is
// a switch that does nothing rather than an error. One JSON read per PR creation, next to a push
// and three gh calls, costs nothing. A missing or corrupt file yields the default (on), which is
// the safe direction for a switch whose off state is invisible.
export function getPrWorkdirFooter(): boolean {
  return loadAppConfig(CONFIG_FILE).prWorkdirFooter;
}

// Whether a spawned session carries the built-in closing-summary instructions (#1062). Read from
// disk per spawn for the same reason as the footer above, and one more: a session outlives the
// write, so the cost of reading stale here is a cell that keeps the old answer until it is
// reopened.
export function getAppendSystemPrompt(): boolean {
  return loadAppConfig(CONFIG_FILE).appendSystemPrompt;
}

// Whether a session's AskUserQuestion choices are offered as buttons in a pane (#1679). Read
// from disk per question, like the two above: questions are rare (one JSON read next to a
// terminal dialog a human is about to read), and a user who has just turned the switch on
// expects the NEXT question to show up rather than the next server start.
export function getQuestionPaneEnabled(): boolean {
  return loadAppConfig(CONFIG_FILE).questionPaneEnabled;
}

/** Called after a config write that CHANGED the saved directories. Injected rather than imported,
 *  so this module stays config-shaped and does not reach into a backend: the collection watchers
 *  are the caller's concern, not the config route's. */
export type CwdPresetsChanged = () => void | Promise<void>;

/** Answer a write that never happened.
 *
 *  A LOCK TIMEOUT IS NOT A FAILURE OF THE SAVE — it is "someone else is mid-write", so it says
 *  retry (503) rather than reporting the user's settings as broken. Not taken means not
 *  attempted: writing anyway is the cross-process race the lock exists to close, and the one
 *  caller that matters records its directory again on the next launch.
 *
 *  Anything else escaping the critical section IS a failure, and must not be dressed as a
 *  transient one — a 503 there would send the client into a retry loop over something that will
 *  never succeed. It also must not go unanswered: an unobserved rejection leaves the request
 *  hanging until the client's own timeout.
 *
 *  `headersSent` because the critical section may have answered already before throwing. */
function answerLockFailure(res: Response, err: unknown): void {
  if (res.headersSent) return;
  if (err instanceof ConfigLockTimeout) {
    res.status(503).json({ error: "config is being written by another process — try again" });
    return;
  }
  console.error("[config] write failed", err);
  res.status(500).json({ error: "failed to persist config" });
}

/** Tell the subscriber, and let nothing it does reach the response.
 *
 *  The config is ALREADY PERSISTED by the time this runs, so a subscriber that throws — or hands
 *  back a promise that rejects — must not turn a save that succeeded into a 500 the client will
 *  retry. Fire-and-forget is the contract this makes true rather than merely states. */
function notifyPresetsChanged(onCwdPresetsChanged?: CwdPresetsChanged): void {
  try {
    void Promise.resolve(onCwdPresetsChanged?.()).catch((err: unknown) => {
      console.warn("[config] cwdPresets subscriber failed", err);
    });
  } catch (err) {
    console.warn("[config] cwdPresets subscriber threw", err);
  }
}

/** The saved-directory routes, at module scope so `mountConfigRoutes` stays inside its line
 *  budget — and because they are their own subsystem: one-entry mutations of a global list. */
function mountCwdPresetRoutes(app: Express, onCwdPresetsChanged?: CwdPresetsChanged): void {
  // ── recording ONE saved directory, server-side ─────────────────────────────────────────────
  //
  // WHY THIS EXISTS AT ALL, and why the client must not do it with `POST /api/config`:
  //
  // `cwdPresets` is a REPLACE-ALL field, and it is global — every mulmoterminal on this machine
  // shares the file, and the list decides which projects the server serves collections for
  // (server/infra/fs/project-root.ts). A client that sends the whole list sends ITS OWN VIEW of it,
  // and any way that view is short, the difference is deleted from disk: the initial GET has not
  // landed yet, the GET failed, another instance added a directory this tab never saw.
  //
  // On 2026-08-09 that cost a user four of five saved directories — a terminal launched while the
  // first GET was in flight persisted `[the one just launched]`, and the collections of the other
  // four stopped being served. Nothing said anything; the config was simply smaller.
  //
  // So "remember this directory" is expressed as what it IS: a one-entry mutation, applied to the
  // list ON DISK, read and written here. A caller cannot clobber a list it never has to hold, and
  // two instances recording different directories at once no longer race each other.
  //
  // The client keeps `POST /api/config` for a genuine replace-all (reordering in a settings UI),
  // where sending the whole list is the user's actual intent.
  app.post("/api/config/cwd-presets/record", (req, res) => {
    const body = requestBody(req.body);
    const path_ = typeof body.path === "string" ? body.path.trim() : "";
    if (!path_) return res.status(400).json({ error: "path is required" });
    // `lastSegment` rather than a "/" split: a Windows path would otherwise become its own label,
    // i.e. the whole absolute path shown as the directory's name.
    const label = typeof body.label === "string" && body.label.trim().length > 0 ? body.label.trim() : lastSegment(path_);
    return void mutatePresets(res, (current) => {
      // Most-recently-used first, and an existing entry keeps the label the user gave it.
      const existing = current.find((preset) => preset.path === path_);
      return [existing ?? { label, path: path_ }, ...current.filter((preset) => preset.path !== path_)];
    });
  });

  // The chip's close button. Same reasoning: a stale client filtering its own copy would drop
  // whatever it had not seen.
  app.post("/api/config/cwd-presets/remove", (req, res) => {
    const body = requestBody(req.body);
    const path_ = typeof body.path === "string" ? body.path : "";
    if (!path_) return res.status(400).json({ error: "path is required" });
    return void mutatePresets(res, (current) => current.filter((preset) => preset.path !== path_));
  });

  /** Apply a one-entry change to the saved directories. Answers the resulting list. */
  function mutatePresets(res: Response, mutate: (current: CwdPreset[]) => CwdPreset[]) {
    return mutateConfigOnDisk(res, onCwdPresetsChanged, {
      update: (base) => ({ cwdPresets: mutate(base.cwdPresets) }),
      answer: (next) => res.json({ cwdPresets: next.cwdPresets }),
    });
  }
}

/** Apply a change to the config ON DISK, reading and writing the file the same way `POST /api/config`
 *  does — including refusing a config we could not parse, so a stray comma never costs the user the
 *  rest of their settings. */
async function mutateConfigOnDisk(res: Response, onCwdPresetsChanged: CwdPresetsChanged | undefined, { refuse, update, answer }: OnDiskChange) {
  // The READ and the WRITE are one critical section, held across processes: several mulmoterminals
  // share this file, and two that each read the old value before either writes both save one missing
  // the other's change. See `withConfigLock`.
  try {
    await withConfigLock(CONFIG_FILE, () => {
      const loaded = loadAppConfigResult(CONFIG_FILE);
      if (loaded.status === "corrupt") {
        const bak = backupCorruptConfig(CONFIG_FILE);
        const backupNote = bak ? ` (backed up to ${path.basename(bak)})` : "";
        return res.status(409).json({ error: `config.json is unreadable and was NOT overwritten${backupNote}. Fix or remove it, then retry.` });
      }
      const base = loaded.status === "ok" ? loaded.config : emptyConfig();
      const unknownKeys = unknownKeysOf(loaded);
      const refusal = refuse?.(base, unknownKeys) ?? null;
      if (refusal !== null) return res.status(409).json(typeof refusal === "string" ? { error: refusal } : refusal);
      const next = mergeConfigUpdate(base, update(base, unknownKeys));
      if (!saveAppConfig(CONFIG_FILE, next, unknownKeys)) return res.status(500).json({ error: "failed to persist config" });
      // Compared against what THIS PROCESS was serving, not against what was on disk. The two differ
      // exactly when another mulmoterminal wrote the file since we booted — whatever field this change
      // was about: adopting `next` silently takes over that instance's directories, and the collection
      // watchers, which read the in-memory list (`getCwdPresets` → `listProjectRoots`), would never
      // hear about the projects they now serve.
      const presetsMoved = !samePresets(config.cwdPresets, next.cwdPresets);
      config = next;
      setTmuxPrefix(next.tmuxPrefix);
      if (presetsMoved) notifyPresetsChanged(onCwdPresetsChanged);
      return answer(next);
    });
  } catch (err) {
    answerLockFailure(res, err);
  }
}

/** The routes that change one entry of a global list against the file, never a client's copy of it —
 *  and the one that reads the whole file back (#2627), which is against the file too. */
function mountOneEntryRoutes(app: Express, onCwdPresetsChanged: CwdPresetsChanged | undefined, configResponse: () => unknown): void {
  mountReload(app, configResponse, onCwdPresetsChanged);
  mountCwdPresetRoutes(app, onCwdPresetsChanged);
  mountPaletteFavoriteRoutes(app, onCwdPresetsChanged);
  const mutate = (res: Response, change: OnDiskChange) => mutateConfigOnDisk(res, onCwdPresetsChanged, change);
  mountAgentEntryRoutes(app, mutate, installBundledSkills);
  mountThemeEntryRoutes(app, mutate);
  mountHeaderChipRoutes(app, mutate);
  mountHeaderButtonRoutes(app, mutate);
  mountKeymapPresetRoute(app, onCwdPresetsChanged);
  mountKeymapBindingRoute(app, (res, change) => mutateConfigOnDisk(res, onCwdPresetsChanged, change));
}

// Settings' Recommended keys (#2581). `keymap` is replaced whole on a write, so the additions are
// worked out HERE, on the keymap in the file under the lock — a tab's copy (or this process's) can be
// missing a binding another mulmoterminal, the keys skill or a hand edit wrote since, and writing it
// back would erase that. `expected` is the list the reader was shown: if the file makes it different,
// nothing is written and the 409 carries the file's keymap for the list to be drawn again.
//
// The keys held by entries this version does not know (a newer release's actions) count as taken: the
// file keeps those entries (#2650), and a preset key on one would leave the newer version two actions
// on one key. The tab cannot see them, so it asks for them (GET) and gets them back with every answer.
function mountKeymapPresetRoute(app: Express, onCwdPresetsChanged?: CwdPresetsChanged): void {
  app.get("/api/config/keymap-preset", (_req, res) => {
    res.json({ reserved: reservedBindings(unknownKeysOf(loadAppConfigResult(CONFIG_FILE)).keymap) });
  });
  app.post("/api/config/keymap-preset", (req, res) => {
    const { platform, expected } = requestBody(req.body);
    if (platform !== "mac" && platform !== "other") return res.status(400).json({ error: "platform (mac|other) required" });
    // A list of another shape is not one this build drew (an old tab after an upgrade): say so, rather
    // than "the keymap changed", which a reload of the list would never fix.
    if (!isPresetChangeList(expected)) return res.status(400).json({ error: "expected must be the list of changes shown" });
    const changesOn = (base: AppConfig, reserved: string[]) => presetChanges(base.keymap, KEYMAP_PRESETS[platform], reserved);
    // Counted from the file under the lock, then carried to the write and the answer (the write keeps them).
    let reserved: string[] = [];
    return void mutateConfigOnDisk(res, onCwdPresetsChanged, {
      refuse: (base, unknownKeys) => {
        reserved = reservedBindings(unknownKeys.keymap);
        if (JSON.stringify(changesOn(base, reserved)) === JSON.stringify(expected)) return null;
        return { error: "the keymap changed since the list was shown", keymap: base.keymap, reserved };
      },
      update: (base) => ({ keymap: withPreset(base.keymap, changesOn(base, reserved)) }),
      answer: (next) => res.json({ keymap: next.keymap, reserved }),
    });
  });
}

/** One palette favorite added or removed (#2546), against the list on disk — the same reason the
 *  saved directories are: a tab sending its own copy of the list would drop what it had not seen. */
function mountPaletteFavoriteRoutes(app: Express, onCwdPresetsChanged?: CwdPresetsChanged): void {
  app.post("/api/config/palette-favorites", (req, res) => {
    const body = requestBody(req.body);
    const key = typeof body.key === "string" ? body.key.trim() : "";
    // Refused rather than accepted and then dropped by the sanitizer, which would answer "saved".
    if (!key || key.length > MAX_PALETTE_KEY_CHARS || typeof body.favorite !== "boolean")
      return res.status(400).json({ error: "key and favorite are required" });
    const favorite = body.favorite;
    return void mutateConfigOnDisk(res, onCwdPresetsChanged, {
      refuse: (base) =>
        favorite && !base.paletteFavorites.includes(key) && base.paletteFavorites.length >= MAX_PALETTE_FAVORITES
          ? `at most ${MAX_PALETTE_FAVORITES} favorites`
          : null,
      update: (base) => ({ paletteFavorites: [...base.paletteFavorites.filter((kept) => kept !== key), ...(favorite ? [key] : [])] }),
      answer: (next) => res.json({ paletteFavorites: next.paletteFavorites }),
    });
  });
}

/**
 * The live config as the API exposes it, so a client (a settings UI) can read back everything it
 * can write — buttons/chips included — and round-trip it.
 *
 * `--agent` wins over the file for THIS run, and ONLY here: `toPublicAppConfig` is also what gets
 * written to disk (serializableAppConfig), so merging the flag in there would persist a
 * one-launch decision into the user's own config file (#2082).
 */
export function effectiveConfigResponse(config: AppConfig, cwd: string, argvAgent: TerminalAgent | null = ARGV_DEFAULT_AGENT): AppConfig & { cwd: string } {
  return { cwd, ...toPublicAppConfig(config), defaultAgent: argvAgent ?? config.defaultAgent };
}

export function mountConfigRoutes(app: Express, claudeCwd: string, onCwdPresetsChanged?: CwdPresetsChanged): void {
  const configResponse = () => effectiveConfigResponse(config, claudeCwd);

  app.get("/api/config", (_req, res) => {
    // `worktreesRoot` rides along with `home`: a runtime fact about THIS server rather than
    // anything the user configured, and the browser cannot work it out — MULMOTERMINAL_HOME can
    // move it. Without it the launcher cannot tell a worktree we created from a directory that
    // merely looks like one, and it must not record ours as a working-directory preset (#1542).
    //
    // CANONICAL, like the one `worktree-env.ts` compares against: the browser can only match this
    // lexically, and the cwd it matches it to came from `git worktree list` — i.e. realpathed. A
    // MULMOTERMINAL_HOME behind a symlink would otherwise never match, and the feature would
    // silently do nothing.
    // `storiesRoots` rides along for the same reason as `worktreesRoot`: a runtime fact about THIS
    // server that the browser cannot work out. Read from the backend rather than derived here —
    // the id is what the plugin REGISTERED, and re-deriving it would answer differently once a
    // workspace symlink is retargeted, handing out a root nothing serves (CodeRabbit on #1934).
    // Its `path` is canonical for the other half of the same problem: the browser compares
    // lexically (`dirPathKey`), so a symlinked spelling would never match the file tree.
    res.json({ ...configResponse(), home: os.homedir(), worktreesRoot: canonicalPath(worktreesRootDir()), storiesRoots: registeredStoriesRoots() });
  });

  // The update notice for the header's "update available" badge, from the check the server runs
  // at startup and every few hours after (startUpdateStatusRefresh). Served from memory; the
  // client re-reads on its own cadence, so both a request that beat the first async check and a
  // release published while this server has been up still reach the badge.
  app.get("/api/update-status", (_req, res) => {
    res.json(getUpdateStatus());
  });

  app.post("/api/config", (req, res) => {
    // Held for the same reason as the one-entry routes below: this re-reads the file as its merge
    // base, so two processes saving different fields at once can each write the other's away.
    void withConfigLock(CONFIG_FILE, () => saveWholeConfig(req, res)).catch((err: unknown) => {
      answerLockFailure(res, err);
    });
  });

  function saveWholeConfig(req: Request, res: Response) {
    const body = requestBody(req.body);
    // Partial update: keep the field the request omits so saving the sound doesn't
    // wipe the presets (and vice-versa). cwdPresets, when present, must be an array.
    const badField = badArrayField(body);
    if (badField) return res.status(400).json({ error: `${badField} must be an array` });
    const badNullableField = badNullableArrayField(body);
    if (badNullableField) return res.status(400).json({ error: `${badNullableField} must be an array or null` });
    const badMapField = badObjectField(body);
    if (badMapField) return res.status(400).json({ error: `${badMapField} must be an object` });
    // Merge onto the CURRENT disk config, re-read now — not this instance's cached
    // `config`, which may be stale (another mulmoterminal instance sharing this file
    // could have written since we booted). Using the stale copy for omitted fields
    // would clobber those edits (e.g. a chips-only POST wiping another's buttons).
    const loaded = loadAppConfigResult(CONFIG_FILE);
    // A corrupt file is real config we merely failed to parse; merging the partial body
    // onto an empty base would erase every omitted field. Back it up and refuse rather
    // than overwrite (a single stray comma must not cost the user their whole config).
    if (loaded.status === "corrupt") {
      const bak = backupCorruptConfig(CONFIG_FILE);
      const backupNote = bak ? ` (backed up to ${path.basename(bak)})` : "";
      return res.status(409).json({
        error: `config.json is unreadable and was NOT overwritten${backupNote}. Fix or remove it, then retry.`,
      });
    }
    // status is "ok" or "missing" here (corrupt returned above). Use the config we already
    // read, or a fresh empty base for a missing file — NOT a second loadAppConfig() read,
    // which could race a concurrent write turning the file corrupt between the two reads and
    // silently merge onto empty.
    const base = loaded.status === "ok" ? loaded.config : emptyConfig();
    const next = mergeConfigUpdate(base, body);
    // Stage, persist, commit in-memory only on success — a failed write must not
    // leave GET exposing values that won't survive a restart.
    // Carry the keys this build doesn't know straight back to disk. Another version's setting
    // must not disappear because this one saved over it (#966).
    if (!saveAppConfig(CONFIG_FILE, next, unknownKeysOf(loaded))) return res.status(500).json({ error: "failed to persist config" });
    // Compared against the config just read from DISK, not this instance's cached copy: another
    // mulmoterminal sharing the file may have written since we booted, and that is the same
    // reason the merge base above is re-read. A stale comparison would both miss a change and
    // invent one.
    // See mutatePresets: the question is whether the list THIS process serves has moved, not
    // whether the file did. A change another instance made and we are only now absorbing is a
    // change from here.
    const previous = config;
    config = next;
    // An account added here has a home with none of the bundled skills in it yet; boot is the only
    // other time they are installed, and a restart is not something saving a setting should need.
    if (body.accounts !== undefined) installBundledSkills();
    // AFTER the commit, and only when the list actually moved: the saved directories are the
    // projects the collection watchers mount for, and without this a directory added mid-session
    // waits out the poll before its collections can ring. Fire-and-forget by contract — a
    // subscriber's failure is its own, and must not turn a saved config into a 500.
    notifySavedChanges(previous, next, onCwdPresetsChanged);
    res.json(configResponse());
  }

  mountOneEntryRoutes(app, onCwdPresetsChanged, configResponse);

  // What the launch form may offer (#584): the configured backends, whether each can be
  // reached right now, and the models it can run. Never the tokens themselves — only the
  // NAME of the variable each is read from, which is what the setup help has to say.
  app.get("/api/launch-options", (_req, res) => {
    res.json(launchOptions(config.providers, process.env));
  });

  // Stream the user's custom attention sound (their own file, set in config). The
  // path comes from server-side config — never from the request — so there's no
  // traversal surface. 404 when unset or the file is gone (the client then falls
  // back to the built-in chime).
  app.get("/api/sound", async (req, res) => {
    // `kind` selects an entry in the server's own `sounds` map and nothing else; the PATH
    // still comes from config, never from the request, so there is no traversal surface.
    // No kind (or an unknown one) asks for the all-kind `soundFile`, which is also what a
    // client from before #873 sends.
    const kind = isNotifyKind(req.query.kind) ? req.query.kind : null;
    const configured = (kind ? config.sounds[kind] : null) ?? null;
    const presetId = configured ? parsePresetRef(configured) : null;
    if (presetId) {
      const bytes = await readSoundPreset(presetId);
      // 503, not 404: the id is known, so a miss here is the download failing (see above).
      return bytes ? res.type("audio/mpeg").send(bytes) : res.status(503).end();
    }
    const file = configured ?? config.soundFile;
    if (!file || !existsSync(file) || !statSync(file).isFile()) return res.status(404).end();
    // `dotfiles: "allow"`, like the directory sound route does with the same kind of value
    // (dir-routes.ts): without it `send` runs its dotfile check over the whole absolute path
    // and 404s a file under any dot directory — `~/.mulmoterminal/chime.mp3` being the obvious
    // place to keep one (#954). No traversal surface: the path is config's, never the
    // request's, as the comment above says.
    res.sendFile(path.resolve(file), { dotfiles: "allow" });
  });

  // Stream a preset attention sound, downloading it into ~/.mulmoterminal/sounds/ the first
  // time. The id is matched against the fixed catalog before anything touches the filesystem
  // or the network, so a request can neither traverse the cache dir nor pick the URL. 404
  // when the id is unknown or the download failed — the client falls back to the chime.
  app.get("/api/sound-preset/:id", async (req, res) => {
    const bytes = await readSoundPreset(req.params.id);
    if (bytes) return res.type("audio/mpeg").send(bytes);
    // A KNOWN id with no bytes is a download that failed — say "try again later" rather than
    // "no such sound", because the client remembers a 404 for the life of the page and would
    // otherwise turn one offline moment into a permanently silent kind.
    res.status(soundPresetById(req.params.id) ? 503 : 404).end();
  });
}
