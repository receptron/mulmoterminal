// @vitest-environment node
// "The same file, unchanged" as one string (#3498).
import { describe, it, expect } from "vitest";
import { fileStamp, type StampedStats } from "../../../server/files/fileStamp";

const BASE: StampedStats = { dev: 7n, ino: 0x2c0000000103c0n, size: 120n, mtimeNs: 1_764_000_000_123_456_789n };

describe("fileStamp", () => {
  it("is equal for the same stats", () => {
    expect(fileStamp({ ...BASE })).toBe(fileStamp(BASE));
  });

  it("changes with each of device, id, size and time", () => {
    const changed: StampedStats[] = [
      { ...BASE, dev: 8n },
      { ...BASE, ino: BASE.ino + 1n },
      { ...BASE, size: 121n },
      { ...BASE, mtimeNs: BASE.mtimeNs + 1n },
    ];
    changed.forEach((other) => expect(fileStamp(other)).not.toBe(fileStamp(BASE)));
  });

  it("tells apart two Windows file ids that are one value as numbers", () => {
    const neighbour = BASE.ino + 1n;
    expect(Number(neighbour)).toBe(Number(BASE.ino)); // the precision a number stat lost
    expect(fileStamp({ ...BASE, ino: neighbour })).not.toBe(fileStamp(BASE));
  });

  it("tells apart a change within one millisecond", () => {
    expect(fileStamp({ ...BASE, mtimeNs: BASE.mtimeNs + 1_000n })).not.toBe(fileStamp(BASE));
  });
});
