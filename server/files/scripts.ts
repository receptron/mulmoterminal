// User-defined scripts the grid's "Run" menu offers, read from `script.json` at
// the workspace root. Extracted from index.ts so the parse/validate/resolve logic
// is unit-testable without spawning a PTY. The browser sends only an INDEX into
// this list (never a raw command), and the server re-reads the file to resolve it
// — so the file is the allowlist of what can run.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface ScriptDef {
  label: string;
  command: string;
  // Optional working dir: relative to the workspace root, or absolute. Omitted =>
  // run in the workspace root.
  cwd?: string;
}

const SCRIPTS_FILE = "script.json";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isScriptDef = (v: unknown): v is ScriptDef =>
  isRecord(v) && typeof v.label === "string" && typeof v.command === "string" && (v.cwd === undefined || typeof v.cwd === "string");

// Normalize arbitrary input into clean script defs: keep only {label,command(,cwd)}
// objects, trim, drop entries missing label or command, and cap the count.
export function sanitizeScripts(input: unknown, max = 100): ScriptDef[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isScriptDef)
    .map((s) => {
      const cwd = s.cwd?.trim();
      return { label: s.label.trim(), command: s.command.trim(), ...(cwd ? { cwd } : {}) };
    })
    .filter((s) => s.label && s.command)
    .slice(0, max);
}

// Read and validate `<workspaceDir>/script.json`. A missing/invalid file yields []
// so the grid still works — the Run menu is just empty.
export function loadScripts(workspaceDir: string): ScriptDef[] {
  try {
    const file = path.join(workspaceDir, SCRIPTS_FILE);
    if (!existsSync(file)) return [];
    return sanitizeScripts(JSON.parse(readFileSync(file, "utf8"))?.scripts);
  } catch {
    return [];
  }
}

// Resolve a script by its position in the loaded list to a runnable command + an
// absolute, existing cwd. Returns null when the index is out of range or the
// resolved cwd isn't a directory — the caller rejects the run instead of guessing.
export function resolveScript(workspaceDir: string, index: number): { command: string; cwd: string } | null {
  const scripts = loadScripts(workspaceDir);
  if (!Number.isInteger(index) || index < 0 || index >= scripts.length) return null;
  const def = scripts[index];
  const cwd = def.cwd ? path.resolve(workspaceDir, def.cwd) : workspaceDir;
  try {
    if (!statSync(cwd).isDirectory()) return null;
  } catch {
    return null;
  }
  return { command: def.command, cwd };
}
