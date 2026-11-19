// Reading one file into the index in bounded batches (#3328). A transcript can hold any number of
// prose records, so what is kept between commits is capped by COUNT, not just by each one's length:
// every SCAN_BATCH_ITEMS items are committed as their own scan, ending at the byte where the next
// record starts, and the next batch continues from there.
import type { FileHandle } from "node:fs/promises";
import { isRecord } from "../../../common/isRecord.js";
import { forEachJsonlRecordIn } from "../../infra/fs/jsonl-file.js";

export const SCAN_BATCH_ITEMS = 1000;

/** Thrown when a commit's claim no longer holds: another process has this file now. */
export class ScanOvertaken extends Error {
  constructor() {
    super("another process indexed this file first");
  }
}

export interface BatchStart {
  from: number;
  /** Where to stop: the size measured before reading, so bytes appended meanwhile wait for the next pass. */
  to: number;
  restart: boolean;
  expectedScannedTo: number | null;
}

export interface BatchCommit<T> {
  items: T[];
  to: number;
  restart: boolean;
  expectedScannedTo: number | null;
}

/** Answers the offset the last batch ended at. `take` folds a record and answers what to keep from it. It runs AFTER any commit at that record's
 *  offset, so the state a commit writes covers exactly the bytes before `to`. */
export async function scanInBatches<T>(
  handle: FileHandle,
  start: BatchStart,
  take: (record: Record<string, unknown>) => T | null,
  commit: (batch: BatchCommit<T>) => boolean,
): Promise<number> {
  let batch: BatchCommit<T> = { items: [], to: start.from, restart: start.restart, expectedScannedTo: start.expectedScannedTo };
  const flush = (to: number): void => {
    if (!commit({ ...batch, to })) throw new ScanOvertaken();
    batch = { items: [], to, restart: false, expectedScannedTo: to };
  };
  const fold = (record: Record<string, unknown>): void => {
    const item = take(record);
    if (item !== null) batch.items.push(item);
  };
  const end = await forEachJsonlRecordIn(handle, { from: start.from, to: start.to, atLineStart: true }, (record, at) => {
    if (batch.items.length >= SCAN_BATCH_ITEMS) flush(at);
    fold(record);
  });
  // The measured end is not an arbitrary cut: what is left before it is the file's last line. A
  // complete record there is folded as it would be at EOF; half of one waits for the rest.
  const last = end < start.to ? await finalRecord(handle, end, start.to) : null;
  if (last !== null) fold(last);
  const scannedTo = last === null ? end : start.to;
  flush(scannedTo);
  return scannedTo;
}

async function finalRecord(handle: FileHandle, from: number, to: number): Promise<Record<string, unknown> | null> {
  const buffer = Buffer.alloc(to - from);
  const { bytesRead } = await handle.read(buffer, 0, to - from, from);
  try {
    const parsed: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null; // still being written
  }
}
