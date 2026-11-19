// Whether a conversation ran from under a temp directory (#3328). Such projects are test fixtures and
// one-shot probes — on the maintainer's machine they are most of `~/.claude/projects` — so the index
// keeps their summary rows for the storage view and leaves their text out of search.
//
// Pure: the roots are handed in. Separators are compared as `/`, and a root that names a Windows
// drive is compared without case, because that file system ignores it.
const WINDOWS_DRIVE = /^[a-z]:\//i;

function normalise(dir: string): string {
  const slashed = dir.replace(/\\/g, "/");
  let end = slashed.length;
  while (end > 0 && slashed[end - 1] === "/") end -= 1;
  return slashed.slice(0, end);
}

function isUnder(cwd: string, root: string): boolean {
  const caseless = WINDOWS_DRIVE.test(root);
  const [child, parent] = caseless ? [cwd.toLowerCase(), root.toLowerCase()] : [cwd, root];
  return child === parent || child.startsWith(`${parent}/`);
}

export function isTemporaryCwd(cwd: string | null, roots: readonly string[]): boolean {
  if (cwd === null || cwd.trim() === "") return false;
  const child = normalise(cwd);
  return roots
    .map(normalise)
    .filter((root) => root !== "")
    .some((root) => isUnder(child, root));
}
