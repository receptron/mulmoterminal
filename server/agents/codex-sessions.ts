import { existsSync, readdirSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 64 * 1024; // enough for session_meta + the first user turn
const TITLE_MAX = 60;
const SCAN_LIMIT = 200; // newest rollout files to inspect per request

export interface CodexSessionSummary {
  id: string;
  title: string;
  mtime: number;
}

interface RolloutHead {
  id: string;
  cwd: string | null;
  title: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function parseJsonRecord(line: string): Record<string, unknown> | null {
  if (!line) return null;
  try {
    const doc: unknown = JSON.parse(line);
    return isRecord(doc) ? doc : null;
  } catch {
    return null; // a truncated final line, or a non-JSON row
  }
}

const isSessionMeta = (d: Record<string, unknown>): boolean =>
  d.type === "session_meta" && isRecord(d.payload) && typeof d.payload.id === "string" && UUID_RE.test(d.payload.id);

// codex records the first real prompt as an event_msg/user_message — distinct from the
// environment_context it injects first (a response_item/message).
const isUserMessage = (d: Record<string, unknown>): boolean =>
  d.type === "event_msg" && isRecord(d.payload) && d.payload.type === "user_message" && typeof d.payload.message === "string";

function stringField(doc: Record<string, unknown> | undefined, key: string): string | null {
  const payload = doc?.payload;
  return isRecord(payload) && typeof payload[key] === "string" ? payload[key] : null;
}

function cleanTitle(raw: string | null): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
  return t || "Codex session";
}

// From a rollout's head, pull the minted id + cwd (session_meta) and a title (first user message).
// Returns null if there's no valid session_meta.
export function parseCodexRolloutHead(head: string): RolloutHead | null {
  const docs = head
    .split("\n")
    .map(parseJsonRecord)
    .filter((d): d is Record<string, unknown> => d !== null);
  const meta = docs.find(isSessionMeta);
  const id = stringField(meta, "id");
  if (!id) return null;
  return { id, cwd: stringField(meta, "cwd"), title: cleanTitle(stringField(docs.find(isUserMessage), "message")) };
}

function subdirsDesc(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Every YYYY/MM/DD directory under the sessions root, newest first.
function dayDirsDesc(root: string): string[] {
  return subdirsDesc(root).flatMap((year) =>
    subdirsDesc(path.join(root, year)).flatMap((month) => subdirsDesc(path.join(root, year, month)).map((day) => path.join(root, year, month, day))),
  );
}

function rolloutsInDay(dayDir: string): string[] {
  return readdirSync(dayDir)
    .filter((n) => ROLLOUT_RE.test(n))
    .sort()
    .reverse()
    .map((f) => path.join(dayDir, f));
}

// Rollout paths newest-first (the filename embeds an ISO timestamp), capped to `scan` so a long
// history stays cheap — only these get their heads read.
function recentRolloutPaths(root: string, scan: number): string[] {
  if (!existsSync(root)) return [];
  return dayDirsDesc(root).flatMap(rolloutsInDay).slice(0, scan);
}

async function readRolloutSummary(file: string): Promise<(RolloutHead & { mtime: number }) | null> {
  let fh;
  try {
    fh = await open(file, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    const head = parseCodexRolloutHead(buf.subarray(0, bytesRead).toString("utf8"));
    if (!head) return null;
    const { mtimeMs } = await fh.stat();
    return { ...head, mtime: mtimeMs };
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

// Does a rollout with this id exist? The id is the filename suffix, so this checks names only (no
// reads). Lets a sidebar-listed codex session be resumed by its rollout id (`codex resume <id>`).
export function codexRolloutExists(root: string, id: string): boolean {
  if (!UUID_RE.test(id) || !existsSync(root)) return false;
  const suffix = `-${id}.jsonl`;
  return dayDirsDesc(root).some((dayDir) => {
    try {
      return readdirSync(dayDir).some((n) => ROLLOUT_RE.test(n) && n.endsWith(suffix));
    } catch {
      return false;
    }
  });
}

// codex sessions for a workspace, newest first — the single view's sidebar list. Scans the most
// recent rollout files, keeps those whose recorded cwd matches, and returns the top `limit`.
export async function listCodexSessions(root: string, cwd: string, limit: number): Promise<CodexSessionSummary[]> {
  const summaries = await Promise.all(recentRolloutPaths(root, SCAN_LIMIT).map(readRolloutSummary));
  return summaries
    .filter((s): s is RolloutHead & { mtime: number } => s !== null && s.cwd === cwd)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((s) => ({ id: s.id, title: s.title, mtime: s.mtime }));
}
