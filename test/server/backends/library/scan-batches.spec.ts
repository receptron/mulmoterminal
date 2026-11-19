// @vitest-environment node
// Reading a file into the index in bounded batches (#3328): where each batch ends, that an
// overtaken commit stops the scan, and that nothing past the measured size is read.
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCAN_BATCH_ITEMS, ScanOvertaken, scanInBatches, type BatchCommit } from "../../../../server/backends/library/scan-batches";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function fileOf(lines: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-scan-batches-"));
  dirs.push(dir);
  const file = path.join(dir, "f.jsonl");
  const body = lines.map((line) => `${line}\n`).join("");
  writeFileSync(file, body);
  return { handle: await open(file, "r"), body };
}

const records = (count: number): string[] => Array.from({ length: count }, (_, i) => JSON.stringify({ n: i }));
const take = (record: Record<string, unknown>): number | null => (typeof record.n === "number" ? record.n : null);

describe("scanInBatches", () => {
  it("commits every batch at the byte where the next record starts, and chains the claims", async () => {
    const lines = records(SCAN_BATCH_ITEMS * 2 + 5);
    const { handle, body } = await fileOf(lines);
    const commits: BatchCommit<number>[] = [];
    try {
      await scanInBatches(
        handle,
        { from: 0, to: Buffer.byteLength(body), restart: true, expectedScannedTo: null },
        take,
        (batch) => (commits.push(batch), true),
      );
    } finally {
      await handle.close();
    }
    const offsetOf = (index: number): number =>
      Buffer.byteLength(
        lines
          .slice(0, index)
          .map((line) => `${line}\n`)
          .join(""),
      );
    expect(commits.map((c) => [c.items.length, c.to, c.restart, c.expectedScannedTo])).toEqual([
      [SCAN_BATCH_ITEMS, offsetOf(SCAN_BATCH_ITEMS), true, null],
      [SCAN_BATCH_ITEMS, offsetOf(SCAN_BATCH_ITEMS * 2), false, offsetOf(SCAN_BATCH_ITEMS)],
      [5, Buffer.byteLength(body), false, offsetOf(SCAN_BATCH_ITEMS * 2)],
    ]);
    expect(commits.flatMap((c) => c.items)).toEqual(lines.map((_, i) => i));
  });

  it("stops at the first commit another process overtook", async () => {
    const { handle, body } = await fileOf(records(SCAN_BATCH_ITEMS * 3));
    let calls = 0;
    try {
      const scan = scanInBatches(handle, { from: 0, to: Buffer.byteLength(body), restart: true, expectedScannedTo: null }, take, () => ++calls < 2);
      await expect(scan).rejects.toBeInstanceOf(ScanOvertaken);
    } finally {
      await handle.close();
    }
    expect(calls).toBe(2);
  });

  it("reads nothing past the size it was given, even when more is there", async () => {
    const lines = records(3);
    const { handle } = await fileOf(lines);
    const measured = Buffer.byteLength(`${lines[0]}\n${lines[1]}\n`);
    const commits: BatchCommit<number>[] = [];
    try {
      await scanInBatches(handle, { from: 0, to: measured, restart: true, expectedScannedTo: null }, take, (batch) => (commits.push(batch), true));
    } finally {
      await handle.close();
    }
    expect(commits).toEqual([{ items: [0, 1], to: measured, restart: true, expectedScannedTo: null }]);
  });

  it("commits once, with nothing, for an empty range", async () => {
    const { handle } = await fileOf([]);
    const commits: BatchCommit<number>[] = [];
    try {
      await scanInBatches(handle, { from: 0, to: 0, restart: false, expectedScannedTo: 0 }, take, (batch) => (commits.push(batch), true));
    } finally {
      await handle.close();
    }
    expect(commits).toEqual([{ items: [], to: 0, restart: false, expectedScannedTo: 0 }]);
  });
});
