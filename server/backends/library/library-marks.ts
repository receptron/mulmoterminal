// Pins and names the user gives conversations in the Library (#3329). Kept in MulmoTerminal's own
// file, never in the agent's transcript, and NOT in the index: the index is a copy that may be deleted
// and rebuilt at any time, and what the user decided must survive that.
import { promises as fs } from "node:fs";
import path from "node:path";
import { emptyLibraryMarks, isLibraryMarks, LIBRARY_NAME_MAX, type LibraryMarkChange, type LibraryMarks } from "../../../common/library.js";
import { MULMOTERMINAL_HOME } from "../../config/env.js";
import { writeFileAtomic } from "../../files/atomic-write.js";
import { createKeySerializer } from "../../infra/async/serialize-per-key.js";

export const LIBRARY_MARKS_FILE = path.join(MULMOTERMINAL_HOME, "library", "marks.json");

/** The marks after one change. Pure: a pin moves to the front, a blank name clears it. */
export function applyMarkChange(marks: LibraryMarks, id: string, change: LibraryMarkChange): LibraryMarks {
  const pinned = change.pinned === undefined ? marks.pinned : [...(change.pinned ? [id] : []), ...marks.pinned.filter((known) => known !== id)];
  if (change.name === undefined) return { pinned, names: marks.names };
  const name = (change.name ?? "").replace(/\s+/g, " ").trim().slice(0, LIBRARY_NAME_MAX);
  const others = Object.fromEntries(Object.entries(marks.names).filter(([known]) => known !== id));
  return { pinned, names: name === "" ? others : { ...others, [id]: name } };
}

/** Absent is empty. Present but unreadable is an error: answering empty would let the next write
 *  replace what the user had with nothing. */
export async function readLibraryMarks(file: string = LIBRARY_MARKS_FILE): Promise<LibraryMarks> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return emptyLibraryMarks();
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isLibraryMarks(parsed)) throw new Error(`${file} is not a marks file`);
  return parsed;
}

const serialize = createKeySerializer();

/** Read, change, write — one at a time per file, so two quick clicks cannot lose one of them. */
export function changeLibraryMark(id: string, change: LibraryMarkChange, file: string = LIBRARY_MARKS_FILE): Promise<LibraryMarks> {
  return serialize(file, async () => {
    const next = applyMarkChange(await readLibraryMarks(file), id, change);
    await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  });
}
