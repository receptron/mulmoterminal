// What makes a set of test tasks the same set (#3491): its `cases.json` and the files each task starts from, so a
// run measured on other starting files is never taken for a measurement of these tasks. Pure.
import { createHash } from "node:crypto";

/** One thing under `files/`: its path from there, with `/` between parts, and the digest of what it holds. */
export interface StartingFile {
  path: string;
  kind: "file" | "link";
  digest: string;
}

const HASH_CHARS = 16;

// By code unit, not by locale: the same files must give the same hash on every machine.
const byPath = (a: StartingFile, b: StartingFile): number => (a.path < b.path ? -1 : Number(a.path > b.path));

/** A set with no starting files keeps the hash of its `cases.json` alone, which is what every run before
 *  starting files were counted recorded: those runs stay measurements of it. */
export function setHash(casesText: string, files: readonly StartingFile[]): string {
  const hash = createHash("sha256").update(casesText);
  if (files.length > 0) {
    files.toSorted(byPath).forEach((file) => hash.update(`\0${file.kind}\0${file.path}\0${file.digest}`));
  }
  return hash.digest("hex").slice(0, HASH_CHARS);
}
