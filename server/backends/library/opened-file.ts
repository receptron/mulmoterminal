// A file read as ONE object (#3328): opened once, measured and read through the same handle, so the
// size recorded, the bytes folded and the head compared all describe the same file even when the
// path is replaced mid-read (see JsonlSource in jsonl-file.ts for why a path cannot promise that).
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { FileStampRead } from "./index-store.js";

/** Enough to tell one transcript from another: the first record names its session and time. */
export const HEAD_BYTES = 256;

export interface OpenedFile {
  handle: FileHandle;
  stamp(): Promise<FileStampRead>;
  /** A hash of the first bytes; a file replaced by another one does not share it. */
  head(): Promise<string>;
  /** A hash of the bytes just before `offset` — where a previous read stopped. A file rewritten in
   *  place while keeping its first bytes still differs here, unless the rewrite left both ends alone. */
  tailAt(offset: number): Promise<string>;
}

export async function withOpenedFile<T>(file: string, work: (opened: OpenedFile) => Promise<T>): Promise<T> {
  const handle = await fs.open(file, "r");
  try {
    return await work({
      handle,
      stamp: () => stampOf(handle),
      head: () => hashOf(handle, 0),
      tailAt: (offset) => hashOf(handle, Math.max(offset - HEAD_BYTES, 0), offset),
    });
  } finally {
    await handle.close();
  }
}

async function stampOf(handle: FileHandle): Promise<FileStampRead> {
  const stat = await handle.stat();
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

async function hashOf(handle: FileHandle, from: number, to = from + HEAD_BYTES): Promise<string> {
  const buffer = Buffer.alloc(to - from);
  const { bytesRead } = await handle.read(buffer, 0, to - from, from);
  return createHash("sha256").update(buffer.subarray(0, bytesRead)).digest("hex");
}
