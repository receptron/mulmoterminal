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

// A working dir discovered from a Claude session, with the session's mtime for recency.
export interface CwdRecord {
  cwd: string;
  mtimeMs: number;
}

// The working directory a session ran in, read from its transcript. Claude records `cwd`
// on its JSONL lines — return the first one found. (The project-dir NAME can't be decoded:
// `/`, `.`, and a literal `-` all encode to `-`, so `my-app` would decode to `my/app`.)
export function extractCwdFromTranscript(raw: string): string | null {
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
      if (typeof cwd === "string" && cwd) return cwd;
    } catch {
      // a partial / non-JSON line (e.g. a truncated head read) — keep scanning
    }
  }
  return null;
}

// Turn discovered session cwds into launch-form presets, newest first: drop dirs that no
// longer exist (via `exists`, so no bogus preset ever lands), dedupe by path keeping the
// newest mtime, then cap at `max`. Pure so the derivation rule is unit-testable.
export function deriveCwdPresets(records: readonly CwdRecord[], exists: (dir: string) => boolean, max = 10): CwdPreset[] {
  const newestByPath = new Map<string, number>();
  for (const { cwd, mtimeMs } of records) {
    if (!cwd || !exists(cwd)) continue;
    const prev = newestByPath.get(cwd);
    if (prev === undefined || mtimeMs > prev) newestByPath.set(cwd, mtimeMs);
  }
  return [...newestByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([dir]) => ({ label: path.basename(dir) || dir, path: dir }));
}
