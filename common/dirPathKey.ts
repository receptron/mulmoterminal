// A directory path reduced to a form two spellings of the same directory share, for comparing a
// path the USER typed against one a tool reported.
//
// Lexical only — no filesystem, because the browser has none. It therefore cannot see through a
// symlink, and is not what any invariant may rest on: the server decides that with a realpath
// containment check (git/worktrees.ts). This exists so a control is greyed out BEFORE the click
// for the spellings a person actually types — a trailing slash, a `.`, a `..` (#1207).
//
// Both separators are folded, since the same app runs on Windows and the field takes either.

const SEPARATORS = /[/\\]+/;

/**
 * The prefix the segment walk below must not eat: a Windows drive root, a UNC share root, or the
 * POSIX root. Anything else is relative and has no root at all.
 *
 * Each of the three is only matched in its ROOTED spelling, so a form that means something else
 * cannot borrow its key (raised by CodeRabbit on #1208): `C:foo` is relative to the current
 * directory ON drive C rather than `C:\foo`, and `\server\share` is a drive-relative path rather
 * than the UNC `\\server\share`. Folding either pair together would let one directory grey out a
 * control belonging to another.
 */
const rootOf = (path: string): string => {
  if (/^[a-zA-Z]:[/\\]/.test(path)) return `${path.slice(0, 2)}/`;
  if (/^[/\\]{2}/.test(path)) return "//";
  return SEPARATORS.test(path.charAt(0)) ? "/" : "";
};

export function dirPathKey(path: string): string {
  const trimmed = path.trim();
  if (trimmed === "") return "";
  const root = rootOf(trimmed);
  const walked: string[] = [];
  for (const segment of trimmed.slice(root.length).split(SEPARATORS)) {
    if (segment === "" || segment === ".") continue;
    // A `..` above a rooted path has nowhere to go, and dropping the root would turn an absolute
    // path into a relative one that could then match something else.
    if (segment === ".." && walked.length > 0 && walked[walked.length - 1] !== "..") walked.pop();
    else if (segment !== ".." || root === "") walked.push(segment);
  }
  return root + walked.join("/");
}

/** Whether two paths name the same directory, as far as spelling can tell. */
export const isSameDirPath = (a: string | null | undefined, b: string | null | undefined): boolean => !!a && !!b && dirPathKey(a) === dirPathKey(b);

/** Whether `path` names a place from a root — POSIX `/…`, a Windows drive root, a UNC share —
 *  rather than one relative to a directory the spelling does not name. The same three spellings
 *  `dirPathKey` keeps, so a caller cannot disagree with it about what "absolute" means. */
export const isRootedPath = (path: string): boolean => rootOf(path.trim()) !== "";
