// A body's chunks, read no further than `maxBytes`: null once the count is passed, and the read is
// cancelled there, so an oversized answer is never held whole.
export async function readChunks(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<Uint8Array[] | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  return chunks;
}
