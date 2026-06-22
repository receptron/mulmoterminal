// The app config persisted at ~/.mulmoterminal/config.json: the user's directory
// presets plus an optional custom attention-sound file. Unified read/write so a
// partial update (e.g. just the sound) never clobbers the other field. Extracted
// from config-routes.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { sanitizePresets, type CwdPreset } from "./cwd-presets.js";

export interface AppConfig {
  cwdPresets: CwdPreset[];
  // Absolute path to a user-supplied audio file played as the attention sound, or
  // null to use the built-in synthesized chime (the default — no bundled asset).
  soundFile: string | null;
}

// Keep only a non-empty string path; anything else clears the custom sound.
export function sanitizeSoundFile(input: unknown): string | null {
  return typeof input === "string" && input.trim() ? input.trim() : null;
}

export function loadAppConfig(file: string): AppConfig {
  try {
    if (!existsSync(file)) return { cwdPresets: [], soundFile: null };
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return { cwdPresets: sanitizePresets(raw?.cwdPresets), soundFile: sanitizeSoundFile(raw?.soundFile) };
  } catch {
    return { cwdPresets: [], soundFile: null };
  }
}

// Persist the whole config; returns false on any write failure so the caller can
// surface it instead of reporting a false success.
export function saveAppConfig(file: string, config: AppConfig): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ cwdPresets: config.cwdPresets, soundFile: config.soundFile }, null, 2));
    return true;
  } catch {
    return false;
  }
}
