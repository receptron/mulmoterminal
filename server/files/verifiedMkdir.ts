// Making a folder after a containment check is the same check-then-act as writing a file (#3306), and
// Node has neither `mkdirat` nor a portable way to open a folder and ask where it landed. So a folder
// is made one level at a time, and after each one the check is asked again: a level that landed
// outside — an ancestor swapped for a link out before the mkdir — is reported, and nothing deeper is
// made. What this does not hold: the outside folder already made is left there, EMPTY (removing it by
// name would be a second check-then-act), and a swap undone before the re-check passes it.
import fs from "node:fs";
import path from "node:path";
import type { Recheck, VerifiedOutcome } from "./verifiedWrite.js";

/** The real path of `abs` inside the root, or null when it is outside (links followed). */
export type Contained = (abs: string) => string | null;

/** Make the one folder `abs` (never over an existing name: EEXIST throws, as `mkdir` does), then ask
 *  the check again: "escaped" when what it names now is not a folder inside. */
export function makeFolderVerified(abs: string, recheck: Recheck): VerifiedOutcome {
  fs.mkdirSync(abs);
  return isFolder(recheck()) ? "written" : "escaped";
}

/** Make every missing folder of `dirLexical`, top first, each through its parent's real path and each
 *  checked once made. An existing level is only checked. */
export function makeFoldersVerified(dirLexical: string, contained: Contained): VerifiedOutcome {
  const missing = missingLevels(dirLexical);
  const escaped = missing.some((level) => makeLevel(level, contained) === "escaped");
  return escaped || !isFolder(contained(dirLexical)) ? "escaped" : "written";
}

function makeLevel(level: string, contained: Contained): VerifiedOutcome {
  const parentReal = contained(path.dirname(level));
  if (!isFolder(parentReal)) return "escaped";
  try {
    return makeFolderVerified(path.join(parentReal, path.basename(level)), () => contained(level));
  } catch (error) {
    // Made meanwhile by someone else: as good as made here, once it too is checked.
    if (hasCode(error, "EEXIST")) return isFolder(contained(level)) ? "written" : "escaped";
    throw error;
  }
}

/** The levels of `dir` that do not exist yet, top first. */
function missingLevels(dir: string): string[] {
  const levels: string[] = [];
  const walk = (at: string): void => {
    if (path.dirname(at) === at || exists(at)) return;
    walk(path.dirname(at));
    levels.push(at);
  };
  walk(path.resolve(dir));
  return levels;
}

const exists = (abs: string): boolean => fs.lstatSync(abs, { throwIfNoEntry: false }) !== undefined;

const isFolder = (abs: string | null): abs is string => abs !== null && (fs.lstatSync(abs, { throwIfNoEntry: false })?.isDirectory() ?? false);

const hasCode = (error: unknown, code: string): boolean => error instanceof Error && "code" in error && error.code === code;
