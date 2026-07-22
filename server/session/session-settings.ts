// Claude Code's per-session `--settings`, written to a file when it carries secrets.
//
// `--settings` accepts a path OR an inline JSON string, and every session until now
// passed it inline. That is fine for hooks, but a provider session's settings carry an
// API token in their `env` block — and an inline argument is visible to every user on
// the host through `ps`. So a settings payload with an env block goes to a 0600 file and
// only its PATH reaches argv (#579).
//
// The env block is the transport for a reason: Claude Code applies it itself, so it
// reaches the session identically on the host, under tmux — where a pane inherits the
// tmux SERVER's environment, not the spawning client's — and inside a container.
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SETTINGS_DIR = path.join(os.homedir(), ".mulmoterminal", "settings");

const settingsFile = (sessionId: string): string => path.join(SETTINGS_DIR, `${sessionId}.json`);

// The settings to pass as `--settings`: the JSON itself when it holds nothing secret,
// otherwise the path to a private file holding it.
export function settingsArgument(sessionId: string, json: string, secret: boolean): string {
  if (!secret) return json;
  const file = settingsFile(sessionId);
  mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(file, json, { encoding: "utf8", mode: 0o600 });
  return file;
}

// Run a spawn, taking the session's settings file with it if the spawn throws. A session
// that never starts never reaches reap(), where the cleanup normally happens — so without
// this a failed spawn leaves a token-bearing file behind (#579).
export function withSettingsCleanup<T>(sessionId: string, spawn: () => T): T {
  try {
    return spawn();
  } catch (err) {
    cleanupSessionSettings(sessionId);
    throw err;
  }
}

// Drop a session's settings file. Safe to call for sessions that never wrote one.
export function cleanupSessionSettings(sessionId: string): void {
  rmSync(settingsFile(sessionId), { force: true });
}
