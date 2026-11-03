// A file OUTSIDE the pane's root, open in the pane on its own (#3238): its tab path is absolute, as
// `rebaseOutsideCwd` joins one — `/…`, `~/…` or `C:/…` — where a file under the root is relative.
// Pure: the shape of the path decides, so every request builder can ask the same question.

const OUTSIDE_PATH = /^(?:\/|~\/|[A-Za-z]:\/)/;
const DRIVE_ONLY = /^[A-Za-z]:$/;

export const isOutsidePath = (path: string): boolean => OUTSIDE_PATH.test(path);

/** The base and name the browse routes are handed for an outside file: its own directory, and its
 *  name under it. `/a.md` is at `/`, `C:/a.md` at `C:/`, `~/a.md` at `~` (the server expands it). */
export function outsideFileTarget(path: string): { cwd: string; pathRel: string } {
  const at = path.lastIndexOf("/");
  return { cwd: directoryOf(path.slice(0, at)), pathRel: path.slice(at + 1) };
}

function directoryOf(dir: string): string {
  if (dir === "") return "/";
  return DRIVE_ONLY.test(dir) ? `${dir}/` : dir;
}
