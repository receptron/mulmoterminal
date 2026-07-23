// @vitest-environment node
import { describe, it, expect } from "vitest";

import { ATTACHMENTS_DIR, extensionForMime, yearMonthUtc } from "../../../../server/backends/remoteHost/attachment-path.js";

describe("extensionForMime", () => {
  it.each([
    ["image/png", ".png"],
    ["image/jpeg", ".jpg"],
    ["image/jpg", ".jpg"], // deliberately the same as image/jpeg
    ["image/webp", ".webp"],
    ["image/gif", ".gif"],
    ["image/heic", ".heic"],
    ["image/heif", ".heif"],
    ["image/tiff", ".tif"], // .tif, not .tiff — pinned so it isn't "corrected"
    ["application/pdf", ".pdf"],
    ["text/plain", ".txt"],
    ["text/markdown", ".md"],
    ["text/csv", ".csv"],
  ])("maps %s to %s", (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext);
  });

  // Case-insensitive: a phone that sends an upper-cased MIME must map the same.
  it.each([
    ["IMAGE/PNG", ".png"],
    ["Application/PDF", ".pdf"],
    ["Image/Jpeg", ".jpg"],
  ])("is case-insensitive for %s", (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext);
  });

  // Anything unmapped falls back to .bin — never a guessed extension.
  it.each(["application/octet-stream", "image/bmp", "video/mp4", "", "not-a-mime"])("falls back to .bin for %j", (mime) => {
    expect(extensionForMime(mime)).toBe(".bin");
  });
});

describe("yearMonthUtc", () => {
  // getUTCMonth is 0-indexed, so the +1 and the zero-pad both have to be right — January must
  // read "01", not "00" or "0".
  it.each<[number, number, string]>([
    [2026, 0, "2026/01"], // January — the +1 boundary
    [2026, 8, "2026/09"], // September — single digit, zero-padded
    [2026, 9, "2026/10"], // October — two digits, not over-padded
    [2026, 11, "2026/12"], // December — the top of the range
    [1999, 0, "1999/01"], // year passes through verbatim
  ])("formats %d-%d as %s", (year, monthIndex, expected) => {
    expect(yearMonthUtc(new Date(Date.UTC(year, monthIndex, 15, 12, 0, 0)))).toBe(expected);
  });

  // Reads UTC fields, not local ones: an instant that is still January 1st in UTC partitions as
  // 2026/01 regardless of the runner's timezone.
  it("uses UTC calendar fields", () => {
    expect(yearMonthUtc(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe("2026/01");
  });
});

describe("ATTACHMENTS_DIR", () => {
  it("is the workspace-relative attachments root", () => {
    expect(ATTACHMENTS_DIR).toBe("data/attachments");
  });
});
