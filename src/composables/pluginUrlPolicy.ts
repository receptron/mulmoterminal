// Whether a plugin view may open a URL in a new tab.
//
// A plugin view runs LLM-authored markup, and openUrl hands its argument to window.open. The
// only thing between that and a `javascript:` / `data:` / `file:` URL executing in the app
// origin is this check — so it is a security boundary, and it should be a tested function
// rather than a branch buried in a closure that no test reaches.
//
// http(s) only, and only when the URL parses at all. An unparseable string is refused rather
// than passed to window.open to interpret however it likes.
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

export function isOpenablePluginUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_SCHEMES.has(parsed.protocol);
}
