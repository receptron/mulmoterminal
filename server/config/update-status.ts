// The "update available" state for the web-header badge. The server runs the check itself
// (shared computeUpdateNotice) rather than reading a launcher-written file, because under
// `yarn dev` the launcher isn't in the loop — only the server is. Recomputed on each start so
// the badge reflects the current checkout (a `git pull` clears it on the next restart); the
// probe is background and best-effort, and the opt-out env vars skip it entirely.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { computeUpdateNotice, isUpdateCheckDisabled } from "../../bin/update-check.js";

// This file is server/config/update-status.ts, so two dirs up is the install root — the git
// checkout (dev / a clone) or the package dir under node_modules (npm) the check runs against.
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { version: VERSION } = createRequire(import.meta.url)("../../package.json") as { version: string };

export interface UpdateStatus {
  notice: string | null;
}

let cached: UpdateStatus = { notice: null };
export function getUpdateStatus(): UpdateStatus {
  return cached;
}

// Populate the in-memory status the route serves. Call fire-and-forget at startup: honours the
// opt-out, else runs the check and caches its result. Best-effort — a failure leaves the badge
// hidden rather than disrupting the server.
export async function refreshUpdateStatus(): Promise<void> {
  if (isUpdateCheckDisabled(process.env)) {
    cached = { notice: null };
    return;
  }
  try {
    cached = { notice: await computeUpdateNotice(PKG_DIR, VERSION) };
  } catch {
    // best-effort — keep the last good value
  }
}
