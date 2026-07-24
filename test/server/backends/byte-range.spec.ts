import { describe, it, expect } from "vitest";

import { parseByteRange } from "../../../server/backends/byte-range.js";

const SIZE = 1000;
const of = (header: string, size = SIZE) => parseByteRange(header, size);
// A well-formed range past the end earns a 416; a malformed/unsupported header is ignored
// (the route then serves the full file). See parseByteRange's RangeResult.
const UNSATISFIABLE = { kind: "unsatisfiable" };
const IGNORE = { kind: "ignore" };

describe("parseByteRange", () => {
  describe("an ordinary range", () => {
    it("takes both ends as given", () => {
      expect(of("bytes=0-499")).toEqual({ kind: "range", start: 0, end: 499 });
    });

    it("serves a single byte", () => {
      expect(of("bytes=0-0")).toEqual({ kind: "range", start: 0, end: 0 });
    });

    it("serves the last byte", () => {
      expect(of("bytes=999-999")).toEqual({ kind: "range", start: 999, end: 999 });
    });

    it("serves the whole file when asked for exactly that", () => {
      expect(of("bytes=0-999")).toEqual({ kind: "range", start: 0, end: 999 });
    });

    it("ignores surrounding whitespace", () => {
      expect(of("  bytes=0-499  ")).toEqual({ kind: "range", start: 0, end: 499 });
    });
  });

  describe("an open-ended range", () => {
    it("runs to the end of the file", () => {
      expect(of("bytes=500-")).toEqual({ kind: "range", start: 500, end: 999 });
    });

    it("from zero is the whole file", () => {
      expect(of("bytes=0-")).toEqual({ kind: "range", start: 0, end: 999 });
    });

    it("from the last byte is that byte", () => {
      expect(of("bytes=999-")).toEqual({ kind: "range", start: 999, end: 999 });
    });
  });

  describe("a suffix range asks for the last n bytes", () => {
    it("counts back from the end", () => {
      expect(of("bytes=-500")).toEqual({ kind: "range", start: 500, end: 999 });
    });

    it("asking for exactly the file gives the whole file", () => {
      expect(of("bytes=-1000")).toEqual({ kind: "range", start: 0, end: 999 });
    });

    // A player seeking to the end does not know the length yet, so it guesses high. The
    // answer is the whole file, not a refusal — this used to be a 416, and a 416 to a media
    // element is a failed seek.
    it("asking for more than the file holds gives the whole file", () => {
      expect(of("bytes=-5000")).toEqual({ kind: "range", start: 0, end: 999 });
    });

    it("asking for nothing is unsatisfiable", () => {
      expect(of("bytes=-0")).toEqual(UNSATISFIABLE);
    });
  });

  // RFC 7233 §2.1: a last-byte-pos at or past the end means "the rest of it". Same reason —
  // the client is guessing, and refusing the guess breaks seeking.
  describe("a far end past the end of the file", () => {
    it("is truncated to the last byte", () => {
      expect(of("bytes=0-99999")).toEqual({ kind: "range", start: 0, end: 999 });
    });

    it("is truncated when the start is partway in", () => {
      expect(of("bytes=900-99999")).toEqual({ kind: "range", start: 900, end: 999 });
    });

    it("is truncated for an absurdly large value", () => {
      expect(of("bytes=0-99999999999999999999")).toEqual({ kind: "range", start: 0, end: 999 });
    });
  });

  describe("nothing to serve", () => {
    it("refuses a start past the end", () => {
      expect(of("bytes=1000-")).toEqual(UNSATISFIABLE);
      expect(of("bytes=1000-1001")).toEqual(UNSATISFIABLE);
    });

    it("refuses a backwards range", () => {
      expect(of("bytes=500-499")).toEqual(UNSATISFIABLE);
    });

    it("refuses any range on an empty file", () => {
      expect(of("bytes=0-0", 0)).toEqual(UNSATISFIABLE);
      expect(of("bytes=0-", 0)).toEqual(UNSATISFIABLE);
      expect(of("bytes=-1", 0)).toEqual(UNSATISFIABLE);
    });
  });

  // A header we don't understand is IGNORED (the route then serves the full 200), NOT a 416.
  // Regression (#748): these all used to collapse to the same null the "nothing to serve"
  // cases did, so the route answered 416 — a failed seek — for a merely malformed header.
  describe("headers that are not a byte range we serve are ignored, not refused", () => {
    it.each([
      ["a missing unit", "0-499"],
      ["another unit", "items=0-499"],
      ["no numbers at all", "bytes=-"],
      ["a non-numeric end", "bytes=0-abc"],
      ["a non-numeric start", "bytes=abc-499"],
      ["a negative number", "bytes=--5"],
      ["a multi-range request", "bytes=0-99,200-299"],
      ["a decimal", "bytes=0.5-9"],
      ["an empty header", ""],
      ["whitespace only", "   "],
      ["a plus sign", "bytes=+0-499"],
      ["internal whitespace", "bytes=0 - 499"],
    ])("ignores %s", (_label, header) => {
      expect(of(header)).toEqual(IGNORE);
    });
  });

  // The one-byte file is where "size - 1" and "start >= size" meet.
  describe("a one-byte file", () => {
    it("serves its only byte", () => {
      expect(of("bytes=0-0", 1)).toEqual({ kind: "range", start: 0, end: 0 });
      expect(of("bytes=0-", 1)).toEqual({ kind: "range", start: 0, end: 0 });
      expect(of("bytes=-1", 1)).toEqual({ kind: "range", start: 0, end: 0 });
    });

    it("refuses anything beyond it", () => {
      expect(of("bytes=1-", 1)).toEqual(UNSATISFIABLE);
    });
  });
});
