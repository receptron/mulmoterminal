// @vitest-environment node
import { describe, it, expect } from "vitest";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { realContainedWithin } from "../../../server/files/pathContainment";
import { seededRandom, type SeededRandom } from "../../helpers/seededRandom.js";

// #3303. Whatever `realContainedWithin` accepts, a write to it must land inside the root — checked by
// writing, over trees of folders, files and links (inside, outside, missing; absolute and relative).
const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);
const TREES_PER_SEED = 8;
const ENTRIES_PER_TREE = 14;
const QUERIES_PER_TREE = 30;
const MARK = "written-by-probe";

const linkTarget = (random: SeededRandom, dirs: string[], entries: string[], index: number): string =>
  random.pick([...dirs, ...entries, path.join(random.pick(dirs), `missing${index}`), path.join(random.pick(dirs), "gone", "deep")]);

function addEntry(random: SeededRandom, dirs: string[], entries: string[], index: number): void {
  const parent = random.pick(dirs);
  const entry = path.join(parent, `${random.pick(["a", "b", "c"])}${index}`);
  const kind = random.fraction();
  if (kind < 0.3) {
    mkdirSync(entry);
    dirs.push(entry);
  } else if (kind < 0.55) writeFileSync(entry, "x");
  else {
    const target = linkTarget(random, dirs, entries, index);
    symlinkSync(random.fraction() < 0.5 ? target : path.relative(parent, target) || ".", entry);
  }
  entries.push(entry);
}

function buildTree(random: SeededRandom, top: string): { root: string; outside: string; entries: string[] } {
  const root = path.join(top, "root");
  const outside = path.join(top, "outside");
  [root, outside].forEach((dir) => mkdirSync(dir));
  const dirs = [root, outside];
  const entries: string[] = [];
  Array.from({ length: ENTRIES_PER_TREE }, (_, index) => addEntry(random, dirs, entries, index));
  return { root, outside, entries };
}

// Links are not followed: the tree has cycles, and a link points at a file that is checked where it is.
const regularFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return regularFilesUnder(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });

const outsideWasWritten = (outside: string): boolean => regularFilesUnder(outside).some((file) => readFileSync(file, "utf8").includes(MARK));

// Each folder's children as spelled THROUGH it, so a path reaches an entry by way of a link.
const spelledChildren = (folder: string): string[] => {
  try {
    return readdirSync(folder).map((name) => path.join(folder, name));
  } catch {
    return [];
  }
};

function probeTree(random: SeededRandom, top: string): string[] {
  const { root, outside, entries } = buildTree(random, top);
  const named = [root, ...entries.filter((entry) => entry.startsWith(root + path.sep))];
  const candidates = [...named, ...named.flatMap(spelledChildren).flatMap((child) => [child, ...spelledChildren(child)])];
  const escapes = Array.from({ length: QUERIES_PER_TREE }, (_, query) => {
    const picked = random.pick(candidates);
    const target = random.fraction() < 0.5 ? path.join(picked, `new${query}`) : picked;
    if (realContainedWithin(root, target) === null) return null;
    try {
      appendFileSync(target, MARK);
    } catch {
      // a folder, or a parent that is missing: nothing was written anywhere
    }
    return outsideWasWritten(outside) ? path.relative(root, target) : null;
  });
  return escapes.filter((escape): escape is string => escape !== null);
}

function probeFreshTree(random: SeededRandom): string[] {
  const top = realpathSync(makeTempDir("mt-contain-"));
  try {
    return probeTree(random, top);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}

describe("realContainedWithin: an accepted path is written inside the root", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const random = seededRandom(seed);
    const escapes = Array.from({ length: TREES_PER_SEED }, () => probeFreshTree(random)).flat();
    expect(escapes).toEqual([]);
  });
});
