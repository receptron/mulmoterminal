// The cwd-relative path a clicked terminal token names, or null when it is not under that
// cwd at all. The Files pane is rooted at its cell's directory and cannot walk above it, so
// this is what decides whether a click can go there or has to keep its old route.
//
// Browser-side, so no `node:path`. A token only becomes a link if it contains `/` and is not
// preceded by `:` (see terminalFilePathLinks), which means a `C:\...` path never reaches here
// — but the CWD still arrives with backslashes on Windows, so separators are normalized
// before anything is compared.

const DRIVE_PREFIX = /^[A-Za-z]:/;

const toSlashes = (p: string): string => p.replace(/\\/g, "/");

// Case-folded only when the root looks like a Windows path. On a case-sensitive filesystem
// `/A/b` and `/a/b` are two directories, and folding would silently accept the wrong one.
const isWindowsRoot = (root: string): boolean => DRIVE_PREFIX.test(root);

const isAbsolute = (p: string): boolean => p.startsWith("/") || DRIVE_PREFIX.test(p);

// The browser does not know the home directory, so a `~` path can never be shown to be inside
// the cwd — and treating it as cwd-relative sent `~/Downloads/x.md` to the pane, which the
// server then refused as an escape once it expanded the tilde (#2260).
const isHomeRelative = (p: string): boolean => p === "~" || p.startsWith("~/");

/** `rel` with `.` dropped and `..` applied, or null when it climbs above the root. Empty
 *  (the root itself, or a path that cancels out) is null too — there is no file to open. */
function resolveSegments(rel: string): string | null {
  const out: string[] = [];
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.pop() === undefined) return null; // climbed past the root
      continue;
    }
    out.push(segment);
  }
  return out.length ? out.join("/") : null;
}

/** `path` with `root` removed, or null when it names something outside. Compared segment by
 *  segment: a plain `startsWith` would let root `/a/b` swallow `/a/bc/d.ts`. */
function stripRoot(path: string, root: string): string | null {
  const fold = (p: string): string => (isWindowsRoot(root) ? p.toLowerCase() : p);
  const rootSegments = fold(root).split("/").filter(Boolean);
  const pathSegments = fold(path).split("/").filter(Boolean);
  if (pathSegments.length < rootSegments.length) return null;
  if (rootSegments.some((segment, i) => segment !== pathSegments[i])) return null;
  // Slice the ORIGINAL, not the folded copy — the server gets the path the user's disk uses.
  return path.split("/").filter(Boolean).slice(rootSegments.length).join("/");
}

/** Where `token` sits inside `cwd`, as a `/`-separated relative path — or null when it is
 *  outside, names the directory itself, or `cwd` is unknown. */
export function pathWithinCwd(token: string, cwd: string | null): string | null {
  if (!cwd) return null;
  const path = toSlashes(token);
  if (isHomeRelative(path)) return null;
  const root = toSlashes(cwd);
  const relative = isAbsolute(path) ? stripRoot(path, root) : path;
  return relative === null ? null : resolveSegments(relative);
}

/** A path outside the cwd, re-expressed as its parent directory plus its name — the shape the
 *  browse routes accept, since any existing directory is a valid base for them. Null when the
 *  token IS within the cwd (it needs no rebasing) or names no file. */
export interface RebasedPath {
  base: string;
  rel: string;
}

const ROOT_PREFIX = /^(~|[A-Za-z]:|)\//;

export function rebaseOutsideCwd(token: string, cwd: string | null): RebasedPath | null {
  if (!cwd || pathWithinCwd(token, cwd) !== null) return null;
  const path = toSlashes(token);
  if (path.endsWith("/")) return null;
  const anchored = isAbsolute(path) || isHomeRelative(path) ? path : `${toSlashes(cwd)}/${path}`;
  const prefix = ROOT_PREFIX.exec(anchored === "~" ? "~/" : anchored)?.[1] ?? "";
  const segments = normalizedSegments(anchored.slice(prefix.length));
  const rel = segments.pop();
  if (rel === undefined) return null;
  return { base: `${prefix}/${segments.join("/")}`, rel };
}

/** Like `resolveSegments`, except a `..` at the top stays at the top — as `path.resolve` does
 *  at a filesystem root — rather than failing. */
function normalizedSegments(rel: string): string[] {
  return rel.split("/").reduce<string[]>((out, segment) => {
    if (segment === "" || segment === ".") return out;
    if (segment === "..") return out.slice(0, -1);
    return [...out, segment];
  }, []);
}
