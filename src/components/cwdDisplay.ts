// Format an absolute working directory for the compact cell header: anchor on the
// home dir (~), and if it's still too long keep the TAIL (the most specific part)
// and drop the front behind an ellipsis — e.g. "…hoge/foo/bar".

export function homeRelative(cwd: string, home: string | null): string {
  if (home && (cwd === home || cwd.startsWith(`${home}/`))) return `~${cwd.slice(home.length)}`;
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
