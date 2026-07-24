// Which bytes a `Range: bytes=…` header actually asks for.
//
// Out of files.ts because the answer decides between 206-with-data and a 416, and a 416 to a
// media player is a failed seek — the one place where being stricter than the spec is worse
// than being wrong (#611 A4). It was reachable only through an HTTP request, and only the
// one satisfiable case was ever exercised.
//
// RFC 7233 §2.1 is deliberately forgiving about the far end of a range, because a player
// asking past the end of a file is normal: it is seeking and does not yet know the length.

export interface ByteRange {
  start: number;
  end: number;
}

// What to do with a `Range:` header. RFC 7233 §3.1/§4.4 draws a line the old code missed:
//  - "range": serve exactly those bytes (206).
//  - "unsatisfiable": a well-formed `bytes=` range that lands entirely past the end — 416.
//  - "ignore": NOT a bytes range we understand (malformed, multi-range, another unit). The
//    spec says ignore it and serve the FULL representation (200) — a 416 here is a failed
//    seek to a media player, worse than just sending the whole file.
export type RangeResult = ({ kind: "range" } & ByteRange) | { kind: "unsatisfiable" } | { kind: "ignore" };

// `bytes=<first>-<last>` with either side optional; anything else is not a range we serve.
const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseByteRange(header: string, size: number): RangeResult {
  const match = BYTE_RANGE.exec(header.trim());
  if (!match) return { kind: "ignore" };
  const [, firstText, lastText] = match;
  // "bytes=-" names neither end — not a range we understand.
  if (firstText === "" && lastText === "") return { kind: "ignore" };

  // A suffix range asks for the LAST n bytes, so the number after the dash is a LENGTH and
  // not a position — it says where the range starts, and the range always runs to the end.
  // Asking for more than the file holds is the whole file, not a refusal: the client cannot
  // know the length before it asks.
  const suffix = firstText === "";
  const start = suffix ? Math.max(0, size - Number(lastText)) : Number(firstText);
  // An absent or past-the-end far side means "to the end", again because a seek is a guess.
  const requestedEnd = suffix || lastText === "" ? size - 1 : Number(lastText);
  const end = Math.min(requestedEnd, size - 1);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: "ignore" };
  // A well-formed range we can't serve: an empty file, a start past the end, or a backwards
  // range. This is the ONE case that earns a 416 (the client asked coherently for bytes that
  // aren't there); a malformed header above just gets the full file instead.
  if (size === 0 || start >= size || end < start) return { kind: "unsatisfiable" };
  return { kind: "range", start, end };
}
