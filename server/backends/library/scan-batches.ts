// Reading one file into the index in bounded batches (#3328). A transcript can hold any number of
// prose records, so what is kept between commits is capped by COUNT, not just by each one's length:
// every SCAN_BATCH_ITEMS items are committed as their own scan, ending at the byte where the next
// record starts, and the next batch continues from there.
import type { FileHandle } from "node:fs/promises";
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

/** `take` folds a record and answers what to keep from it. It runs AFTER any commit at that record's
 *  offset, so the state a commit writes covers exactly the bytes before `to`. */
export async function scanInBatches<T>(
  handle: FileHandle,
  start: BatchStart,
  take: (record: Record<string, unknown>) => T | null,
  commit: (batch: BatchCommit<T>) => boolean,
): Promise<void> {
  let batch: BatchCommit<T> = { items: [], to: start.from, restart: start.restart, expectedScannedTo: start.expectedScannedTo };
  const flush = (to: number): void => {
    if (!commit({ ...batch, to })) throw new ScanOvertaken();
    batch = { items: [], to, restart: false, expectedScannedTo: to };
  };
  const end = await forEachJsonlRecordIn(handle, { from: start.from, to: start.to, atLineStart: true }, (record, at) => {
    if (batch.items.length >= SCAN_BATCH_ITEMS) flush(at);
    const item = take(record);
    if (item !== null) batch.items.push(item);
  });
  flush(end);
}
