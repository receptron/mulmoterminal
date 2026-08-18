import { existsSync, readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "../../common/isRecord.js";
import { cleanTitle, parseJsonRecord, readFirstLine, readTranscriptHead } from "./transcript-head.js";
import { byCodeUnit } from "../../common/byCodeUnit.js";
import { mapConcurrent } from "../infra/mapConcurrent.js";

const ROLLOUT_RE = /^rollout-.*\.jsonl$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Reaching the first user turn, for the handful of rollouts that survive the cwd filter. codex
// writes ~20KB of session_meta and then a preamble before it, so the old 64KB window landed short
// of the title on every `codex exec` rollout measured (median 75KB) and on 13% of interactive ones
// — which is why every row read "Codex session" (#1777).
const HEAD_BYTES = 256 * 1024;
// session_meta is line 1. The probe covers every rollout measured (7–22KB); the ceiling is what a
// longer one grows to rather than vanishing from the listing entirely.
const META_PROBE_BYTES = 32 * 1024;
const META_MAX_BYTES = 1024 * 1024;
const DEFAULT_TITLE = "Codex session";
// Descriptors in flight while scanning the store. Bounded because the scan is now every rollout on
// disk, not a fixed 200.
const READ_CONCURRENCY = 32;

// Threads codex writes for its own machinery, not conversations a person can meaningfully resume.
// They carry the PARENT's cwd (measured 14/14), so without this they match the filter and fill the
// list with untitled rows — 183 of one reporter's newest 200 (#1777).
//
// A deny-list rather than an allow-list of `user`: `thread_source` is absent on rollouts written by
// older codex versions (333 of 3059 here) and takes values we have not seen (`realtime_voice`), and
// those are real conversations. An allow-list would make each new value disappear silently, which
// is the failure this whole issue is about.
const SUPPRESSED_THREAD_SOURCES: ReadonlySet<string> = new Set(["subagent", "automation"]);

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

/** What line 1 answers: which session this file is, and whether it belongs in a listing. */
export interface RolloutMeta {
  id: string;
  cwd: string | null;
  threadSource: string | null;
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
  return { id, cwd: stringField(meta, "cwd"), title: cleanTitle(stringField(docs.find(isUserMessage), "message"), DEFAULT_TITLE) };
}

/** Line 1 of a rollout as the routing facts, or null when it is not a session_meta. */
export function parseCodexSessionMeta(firstLine: string): RolloutMeta | null {
  const doc = parseJsonRecord(firstLine);
  if (!doc || !isSessionMeta(doc)) return null;
  const id = stringField(doc, "id");
  return id === null ? null : { id, cwd: stringField(doc, "cwd"), threadSource: stringField(doc, "thread_source") };
}

/** Is this a thread a person can meaningfully resume? See SUPPRESSED_THREAD_SOURCES. */
export const isResumableThread = (meta: RolloutMeta): boolean => meta.threadSource === null || !SUPPRESSED_THREAD_SOURCES.has(meta.threadSource);

function subdirsDesc(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort(byCodeUnit)
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

// Tolerates a day directory that cannot be read, the same way codexRolloutPath below already does
// — codex prunes these while we walk them. Without it a single unreadable directory throws out of
// the whole scan and the listing answers 500, i.e. NO sessions rather than the ones we could read.
// The scan now enumerates every day rather than stopping at a fixed 200 files, so it meets more of
// them per request (observed during Claude review, not flagged by either bot).
function rolloutsInDay(dayDir: string): string[] {
  try {
    return readdirSync(dayDir)
      .filter((n) => ROLLOUT_RE.test(n))
      .sort(byCodeUnit)
      .reverse()
      .map((f) => path.join(dayDir, f));
  } catch {
    return [];
  }
}

// Every rollout path, newest-first (the filename embeds an ISO timestamp). Directory reads only —
// nothing is opened here.
function allRolloutPaths(root: string): string[] {
  if (!existsSync(root)) return [];
  return dayDirsDesc(root).flatMap(rolloutsInDay);
}

// A rollout's first line is written once, when codex creates the file; every later turn appends.
// So a path's answer never goes stale — which is what keeps the whole-store scan off the
// per-request path.
//
// It does go ABSENT, though: codex prunes rollouts and whole day directories, and a pruned path
// simply stops appearing in the scan. Nothing would then drop its entry, so the map would grow
// with every rollout this process has EVER seen rather than with the files on disk — unbounded in
// a server that runs for weeks (CodeRabbit on #1782). `pruneMetaCache` is what keeps the two in
// step, and it is why the comment above says "a path's answer" rather than "the map".
const metaCache = new Map<string, RolloutMeta | null>();

/** How many paths are currently remembered. Exported for the spec that pins the pruning. */
export const metaCacheSize = (): number => metaCache.size;

/** Drop remembered paths the store no longer has, so the map tracks the disk rather than history. */
function pruneMetaCache(files: readonly string[]): void {
  const live = new Set(files);
  for (const key of metaCache.keys()) if (!live.has(key)) metaCache.delete(key);
}

async function rolloutMeta(file: string): Promise<RolloutMeta | null> {
  const cached = metaCache.get(file);
  if (cached !== undefined) return cached;
  const line = await readFirstLine(file, META_PROBE_BYTES, META_MAX_BYTES);
  if (line === null) return null;
  const meta = parseCodexSessionMeta(line.text);
  // Remember an answer only once line 1 is FINAL — i.e. a newline ended it, or it parsed. This
  // listing is fetched exactly when sessions are being started, so it routinely reads a rollout
  // codex is still writing: unreadable, empty, or a half-written first record. Remembering any of
  // those as "not a session" hides a live conversation until the process restarts, which is the
  // silent disappearance this whole change exists to remove (Codex on #1782, twice).
  if (meta !== null || line.terminated) metaCache.set(file, meta);
  return meta;
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

async function readRolloutSummary(file: string): Promise<(RolloutHead & { mtime: number }) | null> {
  const read = await readTranscriptHead(file, HEAD_BYTES);
  if (!read) return null;
  const head = parseCodexRolloutHead(read.head);
  return head && { ...head, mtime: read.mtime };
}

// The rollout file for this id, or null. The id is the filename suffix, so the search reads
// directory names only. Newest day first, so the answer is found near the front for a live session.
export function codexRolloutPath(root: string, id: string): string | null {
  if (!UUID_RE.test(id) || !existsSync(root)) return null;
  const suffix = `-${id}.jsonl`;
  for (const dayDir of dayDirsDesc(root)) {
    try {
      const name = readdirSync(dayDir).find((n) => ROLLOUT_RE.test(n) && n.endsWith(suffix));
      if (name) return path.join(dayDir, name);
    } catch {
      // a day dir that vanished mid-scan — keep looking
    }
  }
  return null;
}

// Does a rollout with this id exist? Lets a sidebar-listed codex session be resumed by its
// rollout id (`codex resume <id>`).
export const codexRolloutExists = (root: string, id: string): boolean => codexRolloutPath(root, id) !== null;

interface MatchedRollout {
  file: string;
  meta: RolloutMeta;
  mtime: number;
}

/**
 * The rollouts belonging to `cwd`, most recently WRITTEN first.
 *
 * Ordered by mtime rather than by the filename's timestamp because those are not the same thing: a
 * session is appended to for as long as it is open (measured up to 7h past its creation stamp), so
 * the one a user most wants to resume can have the oldest name in the directory.
 */
async function matchingRollouts(root: string, cwd: string): Promise<MatchedRollout[]> {
  const files = allRolloutPaths(root);
  pruneMetaCache(files);
  const metas = await mapConcurrent(files, READ_CONCURRENCY, rolloutMeta);
  const matched = files.flatMap((file, i) => {
    const meta = metas[i];
    return meta != null && meta.cwd === cwd && isResumableThread(meta) ? [{ file, meta }] : [];
  });
  const stamped = await mapConcurrent(matched, READ_CONCURRENCY, async (m) => ({ ...m, mtime: await mtimeOf(m.file) }));
  return stamped.flatMap((s) => (s.mtime === null ? [] : [{ ...s, mtime: s.mtime }])).sort((a, b) => b.mtime - a.mtime);
}

// codex sessions for a workspace, newest first — the launcher's "or resume here" list.
//
// The order here is the fix for #1777 and is the whole point of the function: the cwd filter runs
// over the WHOLE store, and only the rows that survive it are opened for a title. It used to be the
// other way round — a global newest-200 window, filtered afterwards — which on a machine with 3059
// rollouts left 138 of 159 working directories answering with an empty list, including every
// interactive session. codex is the only agent whose store is partitioned by DATE rather than by
// working directory (claude: ~/.claude/projects/<encoded-cwd>, grok: grokCwdDir), so it is the only
// one where a global cap costs accuracy rather than just work — see the note in grok-sessions.ts.
export async function listCodexSessions(root: string, cwd: string, limit: number): Promise<CodexSessionSummary[]> {
  const matches = (await matchingRollouts(root, cwd)).slice(0, limit);
  return mapConcurrent(matches, READ_CONCURRENCY, async ({ file, meta, mtime }) => {
    const summary = await readRolloutSummary(file);
    return { id: meta.id, title: summary?.title ?? DEFAULT_TITLE, mtime: summary?.mtime ?? mtime };
  });
}
