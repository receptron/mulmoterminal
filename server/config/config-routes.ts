// GET/POST /api/config — the default workspace dir, the user's directory presets,
// and an optional custom attention-sound file (persisted at ~/.mulmoterminal/
// config.json), shown/edited in the UI. GET /api/sound streams that sound file.
// Kept in its own module (mounted from index.ts) so grid/preset work doesn't churn
// index.ts and collide with unrelated server changes.
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import type { Express } from "express";
import { loadAppConfig, saveAppConfig, mergeConfigUpdate, type AppConfig } from "./app-config.js";
import { type HeaderConfig } from "./header-config.js";
import { type Launcher, type UserMcpServer } from "./config-schema.js";

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

// Body fields that must be an array when present (a partial POST /api/config may omit any).
const ARRAY_FIELDS = ["cwdPresets", "prRepos", "launchers", "userMcpServers"] as const;
function badArrayField(body: Record<string, unknown>): string | null {
  for (const field of ARRAY_FIELDS) {
    if (body[field] !== undefined && !Array.isArray(body[field])) return field;
  }
  return null;
}

// `buttons`/`chips` are nullable (null = unconfigured), so they can't join ARRAY_FIELDS: reject any present
// value that is neither an array nor null instead of letting the sanitizer silently coerce it to null.
const NULLABLE_ARRAY_FIELDS = ["buttons", "chips"] as const;
function badNullableArrayField(body: Record<string, unknown>): string | null {
  for (const field of NULLABLE_ARRAY_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && !Array.isArray(body[field])) return field;
  }
  return null;
}

export function mountConfigRoutes(app: Express, claudeCwd: string): void {
  // The live config as the API exposes it, so a client (e.g. a settings UI) can read back
  // everything it can write — buttons/chips included — and round-trip it.
  const configResponse = () => ({
    cwd: claudeCwd,
    cwdPresets: config.cwdPresets,
    soundFile: config.soundFile,
    prRepos: config.prRepos,
    launchers: config.launchers,
    userMcpServers: config.userMcpServers,
    buttons: config.buttons,
    chips: config.chips,
    pushEnabled: config.pushEnabled,
    worklogEnabled: config.worklogEnabled,
    worklogIntervalHours: config.worklogIntervalHours,
  });

  app.get("/api/config", (_req, res) => {
    res.json({ ...configResponse(), home: os.homedir() });
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
    const next = mergeConfigUpdate(loadAppConfig(CONFIG_FILE), body);
    // Stage, persist, commit in-memory only on success — a failed write must not
    // leave GET exposing values that won't survive a restart.
    if (!saveAppConfig(CONFIG_FILE, next)) return res.status(500).json({ error: "failed to persist config" });
    config = next;
    res.json(configResponse());
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
