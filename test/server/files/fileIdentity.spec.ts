// @vitest-environment node
// One file or two, by device and file id (#3496).
import { describe, it, expect } from "vitest";
import { isSameIdentity } from "../../../server/files/fileIdentity";

// The shape measured on a GitHub Actions Windows runner: one sequence number (0x2c) over neighbouring
// records. As JS numbers both ids round to one value; as bigint they are two files.
const WINDOWS_A = 0x2c0000000103c0n;
const WINDOWS_B = 0x2c0000000103c1n;

describe("isSameIdentity", () => {
  it("is one file only when device and id both agree", () => {
    expect(isSameIdentity({ dev: 1n, ino: 2n }, { dev: 1n, ino: 2n })).toBe(true);
    expect(isSameIdentity({ dev: 1n, ino: 2n }, { dev: 1n, ino: 3n })).toBe(false); // swapped in between
    expect(isSameIdentity({ dev: 1n, ino: 2n }, { dev: 9n, ino: 2n })).toBe(false);
  });

  it("tells apart two Windows file ids that are one value as numbers", () => {
    expect(Number(WINDOWS_A)).toBe(Number(WINDOWS_B)); // the precision a number-stat comparison lost
    expect(isSameIdentity({ dev: 7n, ino: WINDOWS_A }, { dev: 7n, ino: WINDOWS_B })).toBe(false);
  });

  it("keeps the full 64 bits, the sequence number's high ones included", () => {
    const top = 0xffff_0000_0000_0001n;
    expect(isSameIdentity({ dev: 7n, ino: top }, { dev: 7n, ino: top })).toBe(true);
    expect(isSameIdentity({ dev: 7n, ino: top }, { dev: 7n, ino: top - 1n })).toBe(false);
  });
});
