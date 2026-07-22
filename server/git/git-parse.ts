// Pure parsing rules that were trapped behind `gh` / `git` spawns, so no test reached them.

// The PR URL from `gh pr create` output: the LAST http(s) line. gh prints the PR URL last,
// after any tips or notices — so a tip that happens to contain an http line must not win, and
// the last one is taken rather than the first. Empty output → null (the caller falls back to
// the compare URL).
export function lastGhUrl(stdout: string): string | null {
  const urls = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http"));
  return urls.length ? urls[urls.length - 1] : null;
}

export interface NumstatEntry {
  path: string;
  additions: number;
  deletions: number;
}

// A `git diff --numstat` line: <adds>\t<dels>\t<path>. A binary file reports "-" for its
// counts, which becomes -1 (the badge shows "binary" rather than a bogus +/-). The path is
// rejoined with tabs so a path that itself contains a tab survives.
export function parseNumstatLine(line: string, toCount: (s: string) => number): NumstatEntry {
  const [add, del, ...rest] = line.split("\t");
  const num = (s: string) => (s === "-" ? -1 : toCount(s));
  return { path: rest.join("\t"), additions: num(add), deletions: num(del) };
}

// Cap a diff patch so a huge one does not bloat the payload over the socket; `truncated` tells
// the client it is showing a prefix.
export function capPatch(full: string, limit: number): { patch: string; truncated: boolean } {
  return full.length > limit ? { patch: full.slice(0, limit), truncated: true } : { patch: full, truncated: false };
}
