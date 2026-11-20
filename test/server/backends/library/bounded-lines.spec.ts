// @vitest-environment node
// Splitting a stream into lines with the long ones dropped as they stream (#3330), checked against the
// plain answer — split everything, keep what fits — over generated lines and chunk boundaries.
import { describe, it, expect } from "vitest";
import { boundedLines } from "../../../../server/backends/library/bounded-lines";
import { seededRandom } from "../../../helpers/seededRandom";

async function* chunksOf(bytes: Buffer, cuts: number[]): AsyncGenerator<Buffer> {
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    yield bytes.subarray(start, cut);
    start = cut;
  }
}

const collect = async (lines: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
};

/** The plain answer, holding everything: every line (a last one without a newline too), kept if it fits. */
function expected(text: string, maxBytes: number): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.filter((line) => Buffer.byteLength(line) <= maxBytes);
}

describe("boundedLines", () => {
  it("keeps exactly the lines that fit, whatever the chunk boundaries (generated)", async () => {
    const seed = Date.now() % 100000;
    const draws = seededRandom(seed);
    const next = (): number => draws.fraction();
    const pieces = ["a", "bc", "あ", "😀", "{", "}", " "];
    for (let run = 0; run < 300; run += 1) {
      const lineCount = Math.floor(next() * 6);
      const lines = Array.from({ length: lineCount }, () =>
        Array.from({ length: Math.floor(next() * 12) }, () => pieces[Math.floor(next() * pieces.length)]).join(""),
      );
      const text = lines.join("\n") + (next() < 0.5 ? "\n" : "");
      const bytes = Buffer.from(text);
      const cuts = Array.from({ length: Math.floor(next() * 5) }, () => Math.floor(next() * bytes.length)).sort((a, b) => a - b);
      const maxBytes = Math.floor(next() * 20);
      expect(await collect(boundedLines(chunksOf(bytes, cuts), maxBytes)), `seed ${String(seed)} run ${String(run)}`).toEqual(expected(text, maxBytes));
    }
  });

  it("drops a long line between two short ones, even when it spans many chunks", async () => {
    const text = `short\n${"x".repeat(100)}\nend\n`;
    const bytes = Buffer.from(text);
    const cuts = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
    expect(await collect(boundedLines(chunksOf(bytes, cuts), 10))).toEqual(["short", "end"]);
  });
});
