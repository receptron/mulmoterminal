// Bringing the Library's index up to date with the files on disk (#3328).
//
// One pass walks every transcript, reads only what was appended since the last pass, drops what
// disappeared, then catches up the prompt history. A pass runs only while this process holds the
// lease, so the servers sharing a HOME do the work once between them. Files are read one at a time
// as a stream, and the pass hands the event loop back between files: the first pass over a long
// history is long, and nothing else in the server may wait on it.
import type { DatabaseSync } from "node:sqlite";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { isRecord } from "../../../common/isRecord.js";
import { emptyConversationState, foldConversationRecord, type IndexedTurn } from "./conversation-fold.js";
import { historyPromptOf, type HistoryPrompt } from "./history-fold.js";
import {
  applyHistoryScan,
  applyTranscriptScan,
  finishLease,
  readFileMark,
  recordProgress,
  recordTail,
  removeHistory,
  removeMissingTranscripts,
  takeLease,
  type FileMark,
  type FileStampRead,
} from "./index-store.js";
import { scanInBatches } from "./scan-batches.js";
import { resumePlan, unlessReplaced, type ResumePlan } from "./resume-plan.js";
import { withOpenedFile, type OpenedFile } from "./opened-file.js";
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
  const listing = await listTranscriptFiles(deps.projectsRoot);
  const files = listing.files;
  const seen = new Set<string>();
  for (const [done, file] of files.entries()) {
    if (!takeLease(deps.db, deps.owner, deps.now_ms(), LEASE_TTL_MS)) return false;
    if (await scanTranscriptSafely(deps, file)) seen.add(file.path);
    if (done % PROGRESS_EVERY_FILES === 0) recordProgress(deps.db, deps.owner, done, files.length);
    await yieldToLoop();
  }
  // A walk that could not read some directory does not know those files are gone.
  if (listing.complete) removeMissingTranscripts(deps.db, deps.owner, seen);
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

interface ScanStart {
  mark: FileMark | null;
  plan: ResumePlan;
  head: string;
  /** Measured before reading, and recorded as what was read: see BatchStart.to. */
  stamp: FileStampRead;
}

/** Where a scan of this file starts, or null when it does not need one. */
async function startOf(db: DatabaseSync, path: string, opened: OpenedFile): Promise<ScanStart | null> {
  const mark = readFileMark(db, path);
  const stamp = await opened.stamp();
  const plan = resumePlan(mark, stamp);
  if (plan.kind === "skip") return null;
  const head = await opened.head();
  const tail = plan.kind === "resume" && mark?.tail ? await opened.tailAt(plan.from) : null;
  return { mark, plan: unlessReplaced(plan, mark, { head, tail }), head, stamp };
}

export async function scanTranscript(deps: IndexPassDeps, file: TranscriptFile): Promise<void> {
  await withOpenedFile(file.path, async (opened) => {
    const start = await startOf(deps.db, file.path, opened);
    if (start === null) return;
    const { mark, plan, head, stamp } = start;
    // A stored state that no longer parses cannot be continued; reading from the start can.
    const resumable = plan.kind === "resume" && mark?.state ? { from: plan.from, state: mark.state } : null;
    const { from, state } = resumable ?? { from: 0, state: emptyConversationState() };
    const scan = { from, to: stamp.size, restart: resumable === null, expectedScannedTo: mark?.scannedTo ?? null };
    const end = await scanInBatches<IndexedTurn>(
      opened.handle,
      scan,
      (record) => foldConversationRecord(state, record),
      (batch) => {
        const isTemporary = isTemporaryCwd(state.cwd, deps.temporaryRoots);
        return applyTranscriptScan(deps.db, {
          ...{ path: file.path, id: file.id, agent: "claude", parentId: file.parentId, isTemporary, owner: deps.owner, stamp, head, state },
          ...{ expectedScannedTo: batch.expectedScannedTo, to: batch.to, restart: batch.restart, turns: isTemporary ? [] : batch.items },
        });
      },
    );
    recordTail(deps.db, deps.owner, file.path, end, await opened.tailAt(end));
  });
}

// A history file that is gone takes its prompts with it; one that cannot be read this time keeps them.
async function scanHistorySafely(deps: IndexPassDeps): Promise<void> {
  try {
    await scanHistory(deps);
  } catch (err) {
    if (isMissingFile(err)) removeHistory(deps.db, deps.owner, deps.historyFile);
  }
}

export async function scanHistory(deps: IndexPassDeps): Promise<void> {
  await withOpenedFile(deps.historyFile, async (opened) => {
    const start = await startOf(deps.db, deps.historyFile, opened);
    if (start === null) return;
    const { mark, plan, head, stamp } = start;
    const from = plan.kind === "resume" ? plan.from : 0;
    const scan = { from, to: stamp.size, restart: plan.kind === "restart", expectedScannedTo: mark?.scannedTo ?? null };
    const end = await scanInBatches<HistoryPrompt>(opened.handle, scan, historyPromptOf, (batch) =>
      applyHistoryScan(deps.db, { path: deps.historyFile, owner: deps.owner, stamp, head, ...batch, prompts: batch.items }),
    );
    recordTail(deps.db, deps.owner, deps.historyFile, end, await opened.tailAt(end));
  });
}
