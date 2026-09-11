// The filename `/api/files/raw` advertises for a served file (#2040).
//
// From the REQUESTED spelling, not the resolved path: `resolveContained` realpaths
// (server/files/pathContainment.ts), so a deck reached through a symlink resolves to the
// target's name — which is not what the user clicked, and names a file they did not ask about.
import path from "node:path";

/** Both separators, because `path` only splits on the host's own and `rel` arrives off the wire. */
const SEGMENTS = /[/\\]+/;

/**
 * The last named segment of `rel`, or null when it has none.
 *
 * Null rather than a placeholder: the caller omits the header entirely, which leaves the browser
 * exactly where it was before this existed. A guessed name would be worse than no name.
 */
export function servedFileName(rel: string): string | null {
  // Compared EXACTLY, never trimmed. ` report.pdf` and `report.pdf` are two different files on a
  // POSIX filesystem, and the served bytes are the untrimmed one — `resolveContained` leaves the
  // path alone (its `trimTrailingDotsAndSpaces` only classifies Windows device names). Trimming
  // here advertised a name that did not match the file (CodeRabbit on #2040), which is the same
  // trap `dirPathKey` set for a workspace whose name ended in a space (#1934).
  //
  // `.` and `..` name a directory rather than a file; the containment gate has already refused any
  // `..` that escapes, so one reaching here is a spelling to skip, not a path to resolve.
  const named = rel.split(SEGMENTS).filter((segment) => segment !== "" && segment !== "." && segment !== "..");
  const last = named.at(-1);
  // A trailing `~` expansion (`~/x.pdf`) is already a segment by here; a bare `~` is not a name.
  return last === undefined || last === "~" ? null : path.basename(last);
}
