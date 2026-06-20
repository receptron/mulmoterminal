// Format an absolute working directory for the compact cell header: anchor on the
// home dir (~), and if it's still too long keep the TAIL (the most specific part)
// and drop the front behind an ellipsis — e.g. "…hoge/foo/bar".

export function homeRelative(cwd: string, home: string | null): string {
  if (!home) return cwd;
  // Windows paths use "\" and are case-insensitive (incl. the drive letter).
  const windows = home.includes("\\") || /^[a-zA-Z]:/.test(home);
  const matches = (a: string, b: string) => (windows ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (matches(cwd, home)) return "~";
  // cwd must continue with a separator right after the home prefix (so /Users/me
  // doesn't match /Users/mehmet).
  const next = cwd.charAt(home.length);
  if ((next === "/" || next === "\\") && matches(cwd.slice(0, home.length), home)) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

// Keep the last `max` chars (the tail), prefixed with "…" when truncated.
export function truncateFront(s: string, max: number): string {
  return s.length <= max ? s : `…${s.slice(s.length - (max - 1))}`;
}

export function formatCwd(cwd: string | null, home: string | null, max = 30): string {
  if (!cwd) return "";
  return truncateFront(homeRelative(cwd, home), max);
}
