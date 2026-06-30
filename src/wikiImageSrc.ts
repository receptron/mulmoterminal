// Workspace-relative image rewriter for wiki page bodies. Core deliberately does NOT
// ship one (image-ref rewriting is tied to each host's file-serving scheme — see
// Phase 1.5 of plans/feat-wiki.md), so MulmoTerminal owns this small mapping to its
// own raw-file route, GET /api/files/raw?path=<workspace-relative>.
//
// Wiki pages live at `data/wiki/pages/<slug>.md`, so a relative image ref (`./img.png`,
// `../sources/fig.png`) resolves against that directory; a root-relative ref (`/x.png`)
// resolves against the workspace root. Absolute URLs (http(s), protocol-relative, data:,
// blob:) and already-rewritten `/api/` paths are passed through untouched.

const PAGES_BASE = ["data", "wiki", "pages"];

/** True for refs that must NOT be rewritten (already absolute / external / inlined). */
function isExternal(src: string): boolean {
  const lower = src.toLowerCase();
  return /^https?:\/\//.test(lower) || lower.startsWith("//") || lower.startsWith("data:") || lower.startsWith("blob:") || src.startsWith("/api/");
}

/** Map an image ref found in a wiki page body to a URL the browser can load, or return
 *  it unchanged when it's external / already absolute. Pure string math — collapses
 *  `.`/`..` segments and never climbs above the workspace root. */
export function rewriteWikiImageSrc(src: string): string {
  const ref = src.trim();
  if (!ref || isExternal(ref)) return src;

  // Root-relative (`/foo.png`) resolves from the workspace root; everything else from
  // the page directory.
  const rootRelative = ref.startsWith("/");
  const segs = rootRelative ? [] : [...PAGES_BASE];
  for (const part of ref.replace(/^\/+/, "").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segs.length > 0) segs.pop();
      continue;
    }
    segs.push(part);
  }
  return `/api/files/raw?path=${encodeURIComponent(segs.join("/"))}`;
}
