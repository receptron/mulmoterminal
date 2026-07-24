// GET/POST /api/config — the default workspace dir, the user's directory presets,
// and an optional custom attention-sound file (persisted at ~/.mulmoterminal/
// config.json), shown/edited in the UI. GET /api/sound streams that sound file.
// Kept in its own module (mounted from index.ts) so grid/preset work doesn't churn
// index.ts and collide with unrelated server changes.
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Express } from "express";
import { loadAppConfig, loadAppConfigResult, backupCorruptConfig, saveAppConfig, mergeConfigUpdate, toPublicAppConfig, type AppConfig } from "./app-config.js";
import { type HeaderConfig } from "./header-config.js";
import { type Launcher, type Provider, type UserMcpServer } from "./config-schema.js";
import { launchOptions } from "./launch-options.js";
import { badArrayField, badNullableArrayField } from "./config-body.js";
import { getUpdateStatus } from "./update-status.js";

const CONFIG_FILE = path.join(os.homedir(), ".mulmoterminal", "config.json");
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

// The global terminal-header buttons/chips — read live so /api/header reflects a config
// change on the next fetch without a restart.
export function getHeaderConfig(): HeaderConfig {
  return { buttons: config.buttons, chips: config.chips };
}

// Whether to send a Web Push when a task finishes — read live at the Stop hook so a
// settings toggle takes effect without a restart.
export function getPushEnabled(): boolean {
  return config.pushEnabled;
}

// The periodic dev-work-log settings — read live so a toggle takes effect on the next
// scheduler wiring (a restart, currently). Off by default.
export function getWorklogConfig(): { enabled: boolean; intervalHours: number } {
  return { enabled: config.worklogEnabled, intervalHours: config.worklogIntervalHours };
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
    const base = loaded.status === "ok" ? loaded.config : loadAppConfig(CONFIG_FILE);
    const next = mergeConfigUpdate(base, body);
    // Stage, persist, commit in-memory only on success — a failed write must not
    // leave GET exposing values that won't survive a restart.
    if (!saveAppConfig(CONFIG_FILE, next)) return res.status(500).json({ error: "failed to persist config" });
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
  app.get("/api/sound", (_req, res) => {
    const file = config.soundFile;
    if (!file || !existsSync(file) || !statSync(file).isFile()) return res.status(404).end();
    res.sendFile(path.resolve(file));
  });
}
