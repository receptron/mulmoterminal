// Bringing the Library's index up to date with the files on disk (#3328).
//
// One pass walks every transcript, reads only what was appended since the last pass, drops what
// disappeared, then catches up the prompt history. A pass runs only while this process holds the
// lease, so the servers sharing a HOME do the work once between them. Files are read one at a time
// as a stream, and the pass hands the event loop back between files: the first pass over a long
// history is long, and nothing else in the server may wait on it.
import { promises as fs } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { isRecord } from "../../../common/isRecord.js";
import { forEachJsonlRecordIn } from "../../infra/fs/jsonl-file.js";
import { emptyConversationState, foldConversationRecord, type IndexedTurn } from "./conversation-fold.js";
import { historyPromptOf, type HistoryPrompt } from "./history-fold.js";
import {
  applyHistoryScan,
  applyTranscriptScan,
  finishLease,
  readFileMark,
  recordProgress,
  removeMissingTranscripts,
  takeLease,
  type FileStampRead,
} from "./index-store.js";
import { resumePlan } from "./resume-plan.js";
import { isTemporaryCwd } from "./temporary-path.js";
import { listTranscriptFiles, type TranscriptFile } from "./transcript-files.js";

/** Long enough to cover the slowest single file; renewed after every one. */
export const LEASE_TTL_MS = 60_000;
const PROGRESS_EVERY_FILES = 50;

export interface IndexPassDeps {
  db: DatabaseSync;
  projectsRoot: string;
  historyFile: string;
  temporaryRoots: readonly string[];
  owner: string;
  now_ms: () => number;
}

/** False when another process holds the lease, or took it over part-way. */
export async function runIndexPass(deps: IndexPassDeps): Promise<boolean> {
  if (!takeLease(deps.db, deps.owner, deps.now_ms(), LEASE_TTL_MS)) return false;
  const files = await listTranscriptFiles(deps.projectsRoot);
  const seen = new Set<string>();
  for (const [done, file] of files.entries()) {
    if (!takeLease(deps.db, deps.owner, deps.now_ms(), LEASE_TTL_MS)) return false;
    if (await scanTranscriptSafely(deps, file)) seen.add(file.path);
    if (done % PROGRESS_EVERY_FILES === 0) recordProgress(deps.db, deps.owner, done, files.length);
    await yieldToLoop();
  }
  removeMissingTranscripts(deps.db, seen);
  await scanHistorySafely(deps);
  recordProgress(deps.db, deps.owner, files.length, files.length);
  finishLease(deps.db, deps.owner, deps.now_ms());
  return true;
}

// Only a file that is GONE drops out of the index. Any other failure — a lock held by another
// process, a read that broke off — keeps what the index already has, to be caught up next pass.
async function scanTranscriptSafely(deps: IndexPassDeps, file: TranscriptFile): Promise<boolean> {
  try {
    await scanTranscript(deps, file);
    return true;
  } catch (err) {
    return !isMissingFile(err);
  }
}

const isMissingFile = (err: unknown): boolean => isRecord(err) && err.code === "ENOENT";

async function stampOf(file: string): Promise<FileStampRead> {
  const stat = await fs.stat(file);
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

export async function scanTranscript(deps: IndexPassDeps, file: TranscriptFile): Promise<void> {
  const stamp = await stampOf(file.path);
  const mark = readFileMark(deps.db, file.path);
  const plan = resumePlan(mark, stamp);
  if (plan.kind === "skip") return;
  // A stored state that no longer parses cannot be continued; reading from the start can.
  const resumable = plan.kind === "resume" && mark?.state ? { from: plan.from, state: mark.state } : null;
  const { from, state } = resumable ?? { from: 0, state: emptyConversationState() };
  const turns: IndexedTurn[] = [];
  const to = await forEachJsonlRecordIn(file.path, { from, atLineStart: true }, (record) => {
    const turn = foldConversationRecord(state, record);
    if (turn !== null) turns.push(turn);
  });
  const isTemporary = isTemporaryCwd(state.cwd, deps.temporaryRoots);
  applyTranscriptScan(deps.db, {
    ...{ path: file.path, id: file.id, agent: "claude", parentId: file.parentId, isTemporary, stamp },
    ...{ from, to, restart: resumable === null, state, turns: isTemporary ? [] : turns },
  });
}

async function scanHistorySafely(deps: IndexPassDeps): Promise<void> {
  try {
    await scanHistory(deps);
  } catch {
    // No history file yet, or one we cannot read: search goes on without its prompts.
  }
}

export async function scanHistory(deps: IndexPassDeps): Promise<void> {
  const stamp = await stampOf(deps.historyFile);
  const plan = resumePlan(readFileMark(deps.db, deps.historyFile), stamp);
  if (plan.kind === "skip") return;
  const from = plan.kind === "resume" ? plan.from : 0;
  const prompts: HistoryPrompt[] = [];
  const to = await forEachJsonlRecordIn(deps.historyFile, { from, atLineStart: true }, (record) => {
    const prompt = historyPromptOf(record);
    if (prompt !== null) prompts.push(prompt);
  });
  applyHistoryScan(deps.db, { path: deps.historyFile, stamp, from, to, restart: plan.kind === "restart", prompts });
}
