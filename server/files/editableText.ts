// Whether a file's bytes survive being edited as text (#2038).
//
// The editor reads with `bytes.toString("utf8")` and writes the string back, so **the damage is
// done on READ**: every byte that is not valid UTF-8 becomes U+FFFD, and the save commits that.
// Typing one character into a spreadsheet therefore does not corrupt that character — it commits a
// whole file that was already replaced. Measured on a 324-byte xlsx: it came back 336 bytes and no
// longer opened as a zip.
//
// The test is the round trip itself rather than a heuristic, because the round trip IS what loses
// the data. A NUL-byte sniff — the usual "is it binary" rule — answers a different question and
// gets this one wrong in both directions: a NUL survives editing perfectly, while a Latin-1 `caf\xe9`
// does not and carries no NUL at all.
//
// What it does NOT answer is whether the content is READABLE: UTF-16 text round-trips exactly and
// still shows as mojibake. That is a display question; this one is about destruction.

/** The file as text, or null when editing it would not give the same bytes back. */
export function losslessText(bytes: Buffer): string | null {
  const text = bytes.toString("utf8");
  return Buffer.compare(Buffer.from(text, "utf8"), bytes) === 0 ? text : null;
}
