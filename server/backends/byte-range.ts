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

// `bytes=<first>-<last>` with either side optional; anything else is not a range we serve.
const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseByteRange(header: string, size: number): ByteRange | null {
  const match = BYTE_RANGE.exec(header.trim());
  if (!match) return null;
  const [, firstText, lastText] = match;
  // "bytes=-" names neither end.
  if (firstText === "" && lastText === "") return null;

  // A suffix range asks for the LAST n bytes, so the number after the dash is a LENGTH and
  // not a position — it says where the range starts, and the range always runs to the end.
  // Asking for more than the file holds is the whole file, not a refusal: the client cannot
  // know the length before it asks.
  const suffix = firstText === "";
  const start = suffix ? Math.max(0, size - Number(lastText)) : Number(firstText);
  // An absent or past-the-end far side means "to the end", again because a seek is a guess.
  const requestedEnd = suffix || lastText === "" ? size - 1 : Number(lastText);
  const end = Math.min(requestedEnd, size - 1);

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  // Nothing to serve: an empty file, a start past the end, or a zero-length suffix.
  if (size === 0 || start >= size || end < start) return null;
  return { start, end };
}
