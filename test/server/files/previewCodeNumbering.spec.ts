// @vitest-environment node
import { describe, it, expect } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { existsSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import express from "express";
import { routeCall } from "../../helpers/routeCall";
import { mountFilesBrowseRoutes } from "../../../server/files/files-browse";
import { previewCodeBlocks } from "../../../common/previewCodeBlocks";

// #2615. The Preview's copy button names a block by the number the server drew it with, and the pane
// takes the text from the FILE by that number (common/previewCodeBlocks.ts). The two counts are
// separate code, so this pins them together over generated documents, through the real route.

const PIECES = [
  "```ts\nconst a = 1;\n```",
  '```sh title="run"\necho <b>&amp;\n```',
  "~~~\nplain tilde\n~~~",
  "    indented one\n    indented two",
  "- item\n\n  ```py\n  print('in list')\n  ```",
  "> ```\n> quoted\n> ```",
  "1. one\n   - nested\n\n     ```\n     deep\n     ```",
  "Some `inline` text.",
  "# A heading",
  "<div>\n```\nnot a block inside html\n```\n</div>",
  "| a | b |\n|---|---|\n| `x` | y |",
  "```js\n\n\nblank lines around\n\n```",
  // A diagram's block is drawn inside a disclosure beside its placeholder (#2991); its number must not move.
  "```mermaid\ngraph TD\n  A-->B\n```",
];
const FRONT_MATTER = "---\ntitle: t\nbody: |\n  ```\n  in front matter\n  ```\n---\n";

/** A small deterministic generator, so a failure names a seed that reproduces it. */
const MAX_PIECES = 8;
const LCG_MULTIPLIER = 1103515245n;
const LCG_INCREMENT = 12345n;
const LCG_MODULUS = 2n ** 31n;
const HIGH_BITS_SHIFT = 16;

/** The pieces a seed's document is made of. BigInt, because the multiply overflows a double and the
 *  low bits it lost made most pieces unreachable; and the HIGH bits, which a small LCG randomises. */
function piecesFor(seed: number): number[] {
  let state = BigInt(seed);
  const next = (): number => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
    return Number(state) >>> HIGH_BITS_SHIFT;
  };
  return Array.from({ length: 1 + (next() % MAX_PIECES) }, () => next() % PIECES.length);
}

function documentFor(seed: number): string {
  const body = piecesFor(seed)
    .map((index) => PIECES[index])
    .join("\n\n");
  return (seed % 3 === 0 ? FRONT_MATTER : "") + body + "\n";
}

const ENTITIES: [string, string][] = [
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
  ["&amp;", "&"],
];
/** The text a reader sees in a block's markup: the tags gone, the entities read. */
const visibleText = (html: string): string => {
  const untagged = html
    .split("<")
    .map((part, index) => (index === 0 ? part : part.slice(part.indexOf(">") + 1)))
    .join("");
  return ENTITIES.reduce((text, [entity, char]) => text.replaceAll(entity, char), untagged);
};

const OPENING = '<pre data-code-block="';
/** Each numbered block the server drew: its number and its visible text. */
const drawnBlocks = (html: string): { index: number; text: string }[] =>
  html
    .split(OPENING)
    .slice(1)
    .map((part) => ({
      index: Number.parseInt(part, 10),
      text: withoutTrailingNewlines(visibleText(part.slice(part.indexOf(">") + 1, part.indexOf("</pre>")))),
    }));

const withoutTrailingNewlines = (text: string): string => {
  const lines = text.split("\n");
  const lastWithText = lines.reduce((last, line, index) => (line === "" ? last : index), -1);
  return lines.slice(0, lastWithText + 1).join("\n");
};

const SEEDS = Array.from({ length: 150 }, (_, index) => index + 1);

describe("the Preview's code-block numbers", () => {
  // The generator once collapsed onto a few pieces without anyone noticing; this is what notices.
  it("draws every kind of piece across the seeds", () => {
    const drawn = new Set(SEEDS.flatMap(piecesFor));
    expect([...drawn].sort((a, b) => a - b)).toEqual(PIECES.map((_, index) => index));
  });

  it("name the same block the pane reads from the file, for generated documents", async () => {
    const dir = makeTempDir("mt-code-numbers-");
    const app = express();
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
    try {
      for (const seed of SEEDS) {
        const md = documentFor(seed);
        writeFileSync(path.join(dir, "a.md"), md);
        const res = await routeCall(app)(`/api/files/browse/md?cwd=${encodeURIComponent(dir)}&path=a.md&embed=1`);
        const drawn = drawnBlocks(res.text);
        const read = previewCodeBlocks(md);
        expect(
          drawn.map((block) => block.index),
          `seed ${seed}`,
        ).toEqual(read.map((_, index) => index));
        expect(
          drawn.map((block) => block.text),
          `seed ${seed}`,
        ).toEqual(read.map((block) => block.text));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  // The route the pane reads a block through: the same block, and no backup stored for a press.
  it("answers a block by its number without storing a backup", async () => {
    const dir = makeTempDir("mt-code-numbers-");
    const app = express();
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
    writeFileSync(path.join(dir, "a.md"), documentFor(7));
    try {
      const query = `/api/files/browse/code-block?cwd=${encodeURIComponent(dir)}&path=a.md`;
      const read = previewCodeBlocks(documentFor(7));
      const answers = await Promise.all(read.map((_, index) => routeCall(app)(`${query}&index=${index}`)));
      expect(answers.map((res) => res.body)).toEqual(read);
      expect((await routeCall(app)(`${query}&index=${read.length}`)).body).toMatchObject({ kind: "no-block" });
      expect((await routeCall(app)(`${query}&index=-1`)).status).toBe(400);
      expect(existsSync(path.join(dir, ".backups"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts a copy button on the numbered blocks only in the embeddable document", async () => {
    const dir = makeTempDir("mt-code-numbers-");
    const app = express();
    mountFilesBrowseRoutes(app, { defaultCwd: dir, backupRoot: path.join(dir, ".backups") });
    writeFileSync(path.join(dir, "a.md"), "```\nx\n```\n");
    try {
      const query = `/api/files/browse/md?cwd=${encodeURIComponent(dir)}&path=a.md`;
      expect((await routeCall(app)(`${query}&embed=1`)).text).toContain("pre[data-code-block]");
      expect((await routeCall(app)(query)).text).not.toContain("<script");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
