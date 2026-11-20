// The lines of a byte stream, with any line longer than a limit dropped as it streams (#3330): a
// transcript can hold a tool output of hundreds of megabytes on one line, and gathering it only to
// find it is not wanted is the cost. Pure apart from the chunks it is given.

const NEWLINE = 0x0a;

/** Each complete line up to `maxBytes` (without its newline), as UTF-8 text; longer ones are skipped
 *  without being gathered. A last line with no newline is yielded too — a line still being written is
 *  the caller's to judge. */
export async function* boundedLines(chunks: AsyncIterable<Buffer>, maxBytes: number): AsyncGenerator<string> {
  let parts: Buffer[] = [];
  let size = 0;
  let skipping = false;
  for await (const chunk of chunks) {
    let start = 0;
    for (let end = chunk.indexOf(NEWLINE); end !== -1; end = chunk.indexOf(NEWLINE, start)) {
      if (!skipping && size + (end - start) <= maxBytes) yield Buffer.concat([...parts, chunk.subarray(start, end)]).toString("utf8");
      parts = [];
      size = 0;
      skipping = false;
      start = end + 1;
    }
    if (skipping) continue;
    size += chunk.length - start;
    if (size > maxBytes) {
      skipping = true;
      parts = [];
    } else parts.push(chunk.subarray(start));
  }
  if (!skipping && size > 0) yield Buffer.concat(parts).toString("utf8");
}
