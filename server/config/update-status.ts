// The update notice the launcher leaves in ~/.mulmoterminal/update-status.json for the web
// header to show. The launcher runs the actual check (npm registry / git ls-remote) once at
// startup — this side only reads what it wrote, so the browser can surface an "update
// available" badge the terminal-only console line would otherwise hide.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MULMOTERMINAL_HOME } from "./env.js";

export const UPDATE_STATUS_FILE = path.join(MULMOTERMINAL_HOME, "update-status.json");

export interface UpdateStatus {
  notice: string | null;
}

// The notice out of whatever was parsed from disk, or null. A missing/empty notice, a
// non-string notice, or a non-object file all mean "nothing to show" — never a throw, so a
// hand-edited or partially-written file can't take the header route down.
export function parseUpdateStatus(raw: unknown): UpdateStatus {
  if (typeof raw !== "object" || raw === null) return { notice: null };
  const notice = (raw as { notice?: unknown }).notice;
  return { notice: typeof notice === "string" && notice.length > 0 ? notice : null };
}

// Best-effort read: no file yet (the launcher's async check hasn't written it), an unreadable
// or malformed file, all resolve to no notice rather than an error.
export async function readUpdateStatus(file: string = UPDATE_STATUS_FILE): Promise<UpdateStatus> {
  try {
    return parseUpdateStatus(JSON.parse(await readFile(file, "utf8")));
  } catch {
    return { notice: null };
  }
}
