// GET/POST /api/config — the default workspace dir, the user's directory presets,
// and an optional custom attention-sound file (persisted at ~/.mulmoterminal/
// config.json), shown/edited in the UI. GET /api/sound streams that sound file, and
// GET /api/sound-preset/:id streams one of the built-in preset sounds.
// Kept in its own module (mounted from index.ts) so grid/preset work doesn't churn
// index.ts and collide with unrelated server changes.
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Express } from "express";
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
import { type HeaderConfig } from "./header-config.js";
import { type Launcher, type Provider, type UserMcpServer } from "./config-schema.js";
import type { QuickCommand } from "../../common/quickCommands.js";
import type { PushKind } from "../../common/pushKinds.js";
import { type TerminalSubmitMode } from "../../common/terminalSubmit.js";
import { launchOptions } from "./launch-options.js";
import { badArrayField, badNullableArrayField, badObjectField } from "./config-body.js";
import { getUpdateStatus } from "./update-status.js";
import { readSoundPreset } from "./sound-presets.js";
import { isNotifyKind } from "../../common/notifyKinds.js";
import { parsePresetRef, soundPresetById } from "../../common/notifySounds.js";

export const APP_CONFIG_FILE = path.join(os.homedir(), ".mulmoterminal", "config.json");
const CONFIG_FILE = APP_CONFIG_FILE;
let config: AppConfig = loadAppConfig(CONFIG_FILE);

// The repos the cross-repo PR view aggregates — read live so a POST /api/config that
// changes them takes effect on the next /api/prs without a restart.
export function getPrRepos(): string[] {
  return config.prRepos;
}

// The launch commands a grid cell offers — read live so /ws/launch resolves a launcher
// index against the current list without a restart.
export function getLaunchers(): Launcher[] {
  return config.launchers;
}

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
  return { buttons: config.buttons, chips: config.chips };
}

// Whether to send a Web Push when a task finishes — read live at the Stop hook so a
// settings toggle takes effect without a restart.
// Whether the user opted in to MulmoTerminal writing on their issues (#979). Read live, like the
// rest: turning it off must stop the next comment, not the next restart.
export function getIssueWorkComments(): boolean {
  return config.issueWorkComments;
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

// The periodic dev-work-log settings — read live so a toggle takes effect on the next
// scheduler wiring (a restart, currently). Off by default.
export function getWorklogConfig(): { enabled: boolean; intervalHours: number } {
  return { enabled: config.worklogEnabled, intervalHours: config.worklogIntervalHours };
}

// The Enter-key submit/newline byte mapping — read live so the phone remote-view submit
// picks up a config edit on the next send without a restart (#772).
export function getTerminalSubmit(): TerminalSubmitMode {
  return config.terminalSubmit;
}

// Whether a PR this app creates says which clone it came from (#872).
//
// Read from DISK, unlike every other accessor here, because this setting has no Settings
// control: the only way to set it is to hand-edit config.json, and the in-memory copy is
// refreshed only by POST /api/config. Served from memory it would need a server restart to
// take effect — i.e. a user sets `false`, presses the button, still gets the line, and
// concludes the switch is broken. One JSON read per PR creation, next to a push and three
// gh calls, costs nothing. A missing or corrupt file yields the default (on), which is the
// safe direction for a switch whose off state is invisible.
export function getPrWorkdirFooter(): boolean {
  return loadAppConfig(CONFIG_FILE).prWorkdirFooter;
}

// Whether a spawned session carries the built-in closing-summary instructions (#1062). Read from
// disk per spawn for the same reason as the footer above: it has no Settings control, so served
// from memory a hand-edit would need a server restart to take effect.
export function getAppendSystemPrompt(): boolean {
  return loadAppConfig(CONFIG_FILE).appendSystemPrompt;
}

export function mountConfigRoutes(app: Express, claudeCwd: string): void {
  // The live config as the API exposes it, so a client (e.g. a settings UI) can read back
  // everything it can write — buttons/chips included — and round-trip it.
  const configResponse = () => ({ cwd: claudeCwd, ...toPublicAppConfig(config) });

  app.get("/api/config", (_req, res) => {
    res.json({ ...configResponse(), home: os.homedir() });
  });

  // The update notice for the header's "update available" badge, from the check the server
  // ran at startup (refreshUpdateStatus). Served from memory; the client re-fetches once so a
  // request that beat the async check still picks the notice up.
  app.get("/api/update-status", (_req, res) => {
    res.json(getUpdateStatus());
  });

  app.post("/api/config", (req, res) => {
    const body = req.body ?? {};
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
    config = next;
    res.json(configResponse());
  });

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
