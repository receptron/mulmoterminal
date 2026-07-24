// Path containment shared by the project-scoped file routes (browse + raw serving).
// Trusted-local-user posture: any absolute existing dir is an allowed base, but a
// client-supplied `path` is always contained within that base — no `..` / absolute /
// symlink escape.
import path from "node:path";
import fs from "node:fs";

// Resolve a client-supplied project dir: absolute + existing dir, else the default
// workspace (mirrors index.ts resolveWorkspace).
export function resolveBase(cwd: string | null, defaultCwd: string): string {
  if (cwd && path.isAbsolute(cwd)) {
    try {
      if (fs.statSync(cwd).isDirectory()) return cwd;
    } catch {
      // not a dir / missing — fall through to the default
    }
  }
  return defaultCwd;
}

// Expand a leading `~` to the home dir (`~` alone, or `~/…` / `~\…`). Only a leading
// tilde is a home reference; `~user` and a mid-string `~` are left untouched.
export function expandTilde(p: string, homeDir: string): string {
  if (p === "~") return homeDir;
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(homeDir, p.slice(2));
  return p;
}

// Resolve `rel` under `base`; return the absolute path only if it stays within base
// (reject `..` / absolute escapes). null = escapes the root.
export function containedPath(base: string, rel: string): string | null {
  const root = path.resolve(base);
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // doesn't exist yet (a new file being written) — use the lexical path
  }
}

// Lexical containment (containedPath) can be defeated by a SYMLINK inside the project
// that points outside it. This resolves symlinks in the path's existing portion (a
// not-yet-created write target has none) and confirms the real path still lands within
// `base`. Returns the real absolute path, or null if it escapes.
export function realContainedWithin(base: string, absLexical: string): string | null {
  const root = realpathOr(path.resolve(base));
  const rest: string[] = [];
  let existing = absLexical;
  while (!fs.existsSync(existing)) {
    rest.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) break; // reached the filesystem root
    existing = parent;
  }
  const real = rest.length ? path.resolve(realpathOr(existing), ...rest) : realpathOr(existing);
  if (real !== root && !real.startsWith(root + path.sep)) return null;
  return real;
}
