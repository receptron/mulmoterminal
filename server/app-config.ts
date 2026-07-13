// The app config persisted at ~/.mulmoterminal/config.json: the user's directory
// presets plus an optional custom attention-sound file. Unified read/write so a
// partial update (e.g. just the sound) never clobbers the other field. Extracted
// from config-routes.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { sanitizePresets } from "./cwd-presets.js";
import { sanitizeButtons, sanitizeChips } from "./header-config.js";
import { launcherSchema, userMcpServerSchema, type CwdPreset, type Launcher, type UserMcpServer, type HeaderButton, type HeaderChip } from "./config-schema.js";

export interface AppConfig {
  cwdPresets: CwdPreset[];
  // Absolute path to a user-supplied audio file played as the attention sound, or
  // null to use the built-in synthesized chime (the default — no bundled asset).
  soundFile: string | null;
  // GitHub repos ("owner/repo") whose open PRs the cross-repo PR view aggregates.
  prRepos: string[];
  // User-defined launch commands offered in the grid cell launcher (label + command).
  launchers: Launcher[];
  // User-added HTTP MCP servers merged into the single-view session's --mcp-config.
  userMcpServers: UserMcpServer[];
  // Global terminal-header action buttons; applied to every terminal (scoped with `when`).
  // null = unconfigured (the runtime falls back to DEFAULT_BUTTONS).
  buttons: HeaderButton[] | null;
  // Global header display chips, or null when unconfigured (the client keeps its default set).
  chips: HeaderChip[] | null;
  // Send a Web Push (sendPush Cloud Function) when a task finishes. Off by default; only
  // fires while the RemoteHost channel is connected (that's what supplies the Firebase auth).
  pushEnabled: boolean;
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

// Fresh object each call — callers hold and mutate the returned config in place, so a
// shared default constant would be corrupted across loads.
const emptyConfig = (): AppConfig => ({
  cwdPresets: [],
  soundFile: null,
  prRepos: [],
  launchers: [],
  userMcpServers: [],
  buttons: null,
  chips: null,
  pushEnabled: false,
});

export function loadAppConfig(file: string): AppConfig {
  try {
    if (!existsSync(file)) return emptyConfig();
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return {
      cwdPresets: sanitizePresets(raw?.cwdPresets),
      soundFile: sanitizeSoundFile(raw?.soundFile),
      prRepos: sanitizeRepos(raw?.prRepos),
      launchers: sanitizeLaunchers(raw?.launchers),
      userMcpServers: sanitizeUserMcpServers(raw?.userMcpServers),
      buttons: sanitizeButtons(raw?.buttons),
      chips: sanitizeChips(raw?.chips),
      pushEnabled: sanitizePushEnabled(raw?.pushEnabled),
    };
  } catch {
    return emptyConfig();
  }
}

// Persist the whole config; returns false on any write failure so the caller can
// surface it instead of reporting a false success.
export function saveAppConfig(file: string, config: AppConfig): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const payload = {
      cwdPresets: config.cwdPresets,
      soundFile: config.soundFile,
      prRepos: config.prRepos,
      launchers: config.launchers,
      userMcpServers: config.userMcpServers,
      buttons: config.buttons,
      chips: config.chips,
      pushEnabled: config.pushEnabled,
    };
    writeFileSync(file, JSON.stringify(payload, null, 2));
    return true;
  } catch {
    return false;
  }
}
