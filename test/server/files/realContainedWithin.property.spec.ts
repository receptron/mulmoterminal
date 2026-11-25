// @vitest-environment node
import { describe, it, expect } from "vitest";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../support/tempDir.js";
import { realContainedWithin } from "../../../server/files/pathContainment";
import { seededRandom, type SeededRandom } from "../../helpers/seededRandom.js";

// #3303. Whatever `realContainedWithin` accepts, a write to it must land inside the root, and at the
// path it answered — checked by writing, over trees of folders, files and links (inside, outside,
// missing; absolute, relative, and relative by way of another entry).
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
  else symlinkSync(spelledTarget(random, parent, linkTarget(random, dirs, entries, index), entries), entry);
  entries.push(entry);
}

// Absolute, relative, or relative by way of `<another entry>/..` — which the OS reads by following that
// entry first, so a link there changes where the `..` lands. Joined by hand: path.join would cancel it.
function spelledTarget(random: SeededRandom, parent: string, target: string, entries: string[]): string {
  const relative = path.relative(parent, target) || ".";
  const kind = random.fraction();
  if (kind < 0.4) return target;
  if (kind < 0.7 || entries.length === 0) return relative;
  return [path.relative(parent, random.pick(entries)), "..", relative].join(path.sep);
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

// What went wrong for one accepted path, or null: the write left the root, or it landed somewhere other
// than the path the gate answered — which is the path every route then reads and writes.
function probeOne(root: string, outside: string, target: string, mark: string): string | null {
  const answered = realContainedWithin(root, target);
  if (answered === null) return null;
  try {
    appendFileSync(target, mark);
  } catch {
    return null; // a folder, or a parent that is missing: nothing was written anywhere
  }
  if (outsideWasWritten(outside)) return `${path.relative(root, target)}: written outside`;
  return readTextOrEmpty(answered).includes(mark) ? null : `${path.relative(root, target)}: written somewhere other than ${answered}`;
}

const readTextOrEmpty = (file: string): string => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

// Listed only where it really is inside the tree: a link can lead out of it — by way of `..`, up to
// the system temp folder — and listing that walked every other program's files (#3504). A path that
// leads out is still a candidate to query; only its children are not gathered. `.native`: the JS
// realpath cancels a target's `<link>/..` on paper, so it answered "inside" for the very link that
// the OS followed out.
const isInsideTree = (realTop: string, folder: string): boolean => {
  try {
    const real = realpathSync.native(folder);
    return real === realTop || real.startsWith(realTop + path.sep);
  } catch {
    return false;
  }
};

function probeTree(random: SeededRandom, top: string): string[] {
  const { root, outside, entries } = buildTree(random, top);
  const named = [root, ...entries.filter((entry) => entry.startsWith(root + path.sep))];
  const realTop = realpathSync.native(top); // the same spelling the check compares against, Windows short names included
  const childrenInTree = (folder: string): string[] => (isInsideTree(realTop, folder) ? spelledChildren(folder) : []);
  const candidates = [...named, ...named.flatMap(childrenInTree).flatMap((child) => [child, ...childrenInTree(child)])];
  const problems = Array.from({ length: QUERIES_PER_TREE }, (_, query) => {
    const picked = random.pick(candidates);
    const target = random.fraction() < 0.5 ? path.join(picked, `new${query}`) : picked;
    return probeOne(root, outside, target, `${MARK}-${query}`);
  });
  return problems.filter((problem): problem is string => problem !== null);
}

function probeFreshTree(random: SeededRandom): string[] {
  const top = realpathSync(makeTempDir("mt-contain-"));
  try {
    return probeTree(random, top);
  } finally {
    rmSync(top, { recursive: true, force: true });
  }
}

describe("realContainedWithin: an accepted path is written inside the root, where it said", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const random = seededRandom(seed);
    const problems = Array.from({ length: TREES_PER_SEED }, () => probeFreshTree(random)).flat();
    expect(problems).toEqual([]);
  });
});
