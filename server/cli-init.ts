// `npx mulmoterminal init` — config half (spawned via tsx by bin/mulmoterminal.js).
// Derives working-directory presets from the user's Claude Code history and writes them
// into ~/.mulmoterminal/config.json, preserving every other field. Idempotent: re-running
// re-derives and overwrites the managed presets. The environment/CLI checks + the optional
// interactive-config launch live in the bin (where PATH-command detection is intentional).
import { statSync, readdirSync, openSync, readSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAppConfig, mergeConfigUpdate, saveAppConfig } from "./config/app-config.js";
import { deriveCwdPresets, extractCwdFromTranscript, type CwdRecord } from "./config/cwd-presets.js";

const CONFIG_FILE = path.join(os.homedir(), ".mulmoterminal", "config.json");
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const MAX_PRESETS = 10;
const HEAD_BYTES = 16384; // cwd is on an early transcript line — read only the head

const log = (m: string) => console.log(`\x1b[36m[init]\x1b[0m ${m}`);

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Read just the head of a (possibly large) transcript.
function readHead(file: string): string {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

// The newest *.jsonl in a project dir (its mtime is our recency signal for the dir's cwd).
function newestTranscript(dir: string): { file: string; mtimeMs: number } | null {
  let best: { file: string; mtimeMs: number } | null = null;
  for (const name of safeReaddir(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    try {
      const s = statSync(path.join(dir, name));
      if (!best || s.mtimeMs > best.mtimeMs) best = { file: path.join(dir, name), mtimeMs: s.mtimeMs };
    } catch {
      // unreadable file — skip
    }
  }
  return best;
}

function collectCwdRecords(): CwdRecord[] {
  const records: CwdRecord[] = [];
  for (const project of safeReaddir(PROJECTS_DIR)) {
    const dir = path.join(PROJECTS_DIR, project);
    if (!isDir(dir)) continue;
    const newest = newestTranscript(dir);
    if (!newest) continue;
    const cwd = extractCwdFromTranscript(readHead(newest.file));
    if (cwd) records.push({ cwd, mtimeMs: newest.mtimeMs });
  }
  return records;
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const presets = deriveCwdPresets(collectCwdRecords(), isDir, MAX_PRESETS);
  if (presets.length === 0) {
    log("No existing Claude working directories found — leaving presets unchanged.");
    return;
  }
  if (dryRun) {
    log(`[dry-run] Would set ${presets.length} working-directory preset(s) (no changes written):`);
    for (const p of presets) console.log(`    • ${p.path}`);
    return;
  }
  const next = mergeConfigUpdate(loadAppConfig(CONFIG_FILE), { cwdPresets: presets });
  if (!saveAppConfig(CONFIG_FILE, next)) {
    console.error(`\x1b[31m[init]\x1b[0m Failed to write ${CONFIG_FILE}`);
    process.exit(1);
  }
  log(`Working-directory presets set from your Claude history (${presets.length}):`);
  for (const p of presets) console.log(`    • ${p.path}`);
  log(`Saved to ${CONFIG_FILE}`);
}

main();
