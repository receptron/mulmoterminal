// Staging for files that arrive as BYTES rather than as a path.
//
// Dropping a file on the terminal normally inserts its absolute path (dropPaths.ts) — the agent
// then reads it itself, which is the whole point. But the path is only reachable through the
// drag's `text/uri-list`, and Chrome withholds it, so on the browser most people use, dropping a
// screenshot does nothing but show a hint. A pasted screenshot (⌘⌃⇧4 → clipboard) has no path at
// ALL, in any browser: there is no file on disk to name.
//
// Both cases have the bytes. Writing them somewhere real and inserting THAT path turns "nothing
// happened" into the same outcome the path drop already produces, without the agent needing any
// new concept — it still just reads a file.
//
// Staged under ~/.mulmoterminal/drops/<date>/<random>/<original name>, never inside the session's
// working directory: a screenshot dropped while working in a repo must not become an untracked
// file in someone's diff. The original name is preserved (it is often the only clue about what
// the file is) and the random parent is what makes the path unique.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseDataUrl, approxBytes, type AudioParts } from "../backends/audioAdmission.js";

// A retina screenshot is a few MB; a phone photo can be 10+. 25 MiB leaves room without letting
// one paste write an arbitrarily large file into the home dir.
export const MAX_DROP_BYTES = 25 * 1024 * 1024;
// base64 is ~+33%; a loose pre-decode bound so an oversized payload is refused before it is
// expanded into memory (same ordering rule as audioAdmission).
export const MAX_DROP_DATAURL_CHARS = MAX_DROP_BYTES * 3;
// Staged files are a transient hand-off, not a library. A week is long enough to re-reference
// something from yesterday's session and short enough that the directory doesn't grow forever.
export const DROP_RETENTION_DAYS = 7;

const BAD_REQUEST = 400;
const PAYLOAD_TOO_LARGE = 413;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

export const dropsRoot = (): string => path.join(os.homedir(), ".mulmoterminal", "drops");

/** A filename safe to join onto a directory we chose. Everything structural is stripped rather
 *  than escaped — a name is display sugar here, and the random parent already guarantees
 *  uniqueness, so there is nothing to lose by being blunt about it. */
export function safeDropName(name: unknown, mimeType: string): string {
  const raw = typeof name === "string" ? name : "";
  // basename first: a name of "../../x" must not climb, and a browser may send a full path.
  const base = path.basename(raw.replace(/\\/g, "/")).trim();
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, "-") // keep it boring: no spaces, no quotes, no shell characters
    .replace(/^[.-]+/, "") // a leading dot would hide it; a leading dash reads as a flag
    .slice(0, 80);
  if (cleaned) return cleaned;
  // No usable name (a pasted screenshot has none) — synthesize one from the type, so the
  // inserted path still tells the reader what they are looking at.
  return `pasted${MIME_EXTENSIONS[mimeType] ?? ""}`;
}

export type DropAdmission = { ok: true; parts: AudioParts; name: string } | { ok: false; status: number; error: string };

/** Size and shape checks, in the order that keeps a huge payload from being decoded first. */
export function admitDroppedFile(dataUrl: unknown, name: unknown): DropAdmission {
  if (typeof dataUrl !== "string" || !dataUrl) return { ok: false, status: BAD_REQUEST, error: "dataUrl is required" };
  if (dataUrl.length > MAX_DROP_DATAURL_CHARS) return { ok: false, status: PAYLOAD_TOO_LARGE, error: "file exceeds the size limit" };
  const parts = parseDataUrl(dataUrl);
  if (!parts) return { ok: false, status: BAD_REQUEST, error: "dataUrl must be a base64 data: URI" };
  if (approxBytes(parts.base64) > MAX_DROP_BYTES) return { ok: false, status: PAYLOAD_TOO_LARGE, error: "file exceeds the size limit" };
  return { ok: true, parts, name: safeDropName(name, parts.mimeType) };
}

const dateDir = (now: Date): string => now.toISOString().slice(0, 10); // YYYY-MM-DD, stable across timezones

/** Delete staged directories older than the retention window. Best-effort: a drop that can't be
 *  swept is not a reason to fail the drop the user is making right now. */
export function sweepOldDrops(now: Date, root: string = dropsRoot()): void {
  const cutoff = new Date(now.getTime() - DROP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const oldest = dateDir(cutoff);
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return; // nothing staged yet
  }
  for (const entry of entries) {
    // Only touch names this module creates. A stray file or a hand-made directory is left alone
    // rather than deleted by a rule it was never subject to.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry) || entry >= oldest) continue;
    try {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    } catch {
      // keep going: one undeletable directory must not stop the rest
    }
  }
}

/** Write the admitted bytes and return the absolute path to insert. */
export function saveDroppedFile(admitted: Extract<DropAdmission, { ok: true }>, now: Date = new Date(), root: string = dropsRoot()): string {
  const dir = path.join(root, dateDir(now), crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, admitted.name);
  fs.writeFileSync(file, Buffer.from(admitted.parts.base64, "base64"));
  return file;
}
