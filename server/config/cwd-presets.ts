// Directory presets the launch form offers, persisted at config.json. Extracted
// from index.ts so the sanitize/load/save logic is unit-testable.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { type CwdPreset } from "./config-schema.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isPreset = (v: unknown): v is CwdPreset => isRecord(v) && typeof v.label === "string" && typeof v.path === "string";

// Normalize arbitrary input into clean presets: keep only {label,path} objects,
// trim, drop entries missing either field, and cap the count.
export function sanitizePresets(input: unknown, max = 50): CwdPreset[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isPreset)
    .map((p) => ({ label: p.label.trim(), path: p.path.trim() }))
    .filter((p) => p.label && p.path)
    .slice(0, max);
}

export function loadPresets(file: string): CwdPreset[] {
  try {
    if (!existsSync(file)) return [];
    return sanitizePresets(JSON.parse(readFileSync(file, "utf8"))?.cwdPresets);
  } catch {
    return [];
  }
}

// Persist; returns false on any write failure so the caller can surface it
// instead of reporting a false success.
export function savePresets(file: string, presets: CwdPreset[]): boolean {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ cwdPresets: presets }, null, 2));
    return true;
  } catch {
    return false;
  }
}
