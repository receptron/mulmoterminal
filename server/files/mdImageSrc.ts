// Where a Markdown image should be fetched from when the document is served by a browse route.
//
// The document's URL is `/api/files/browse/md?…`, so a relative `src` resolves against
// `/api/files/browse/` and 404s (#2261). It is rewritten to the raw route, relative to the
// document's own directory. Pure, so the rules below can be tested without a server.

/** Where the document sits: the base it was served against, and its directory under that base as
 *  a `/`-separated relative path ("" for the base itself). */
export interface ServedDoc {
  base: string;
  dirRel: string;
}

const RAW_ROUTE = "/api/files/raw";

// A scheme (`https:`, `data:`), a root- or protocol-relative path, or an in-page reference: the
// author pointed somewhere other than a file beside the document, so it is left as written.
const NOT_FILE_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|[/\\#?])/i;

/** The `/`-joined path, or null when it climbs above the base — the raw route would refuse it,
 *  and leaving it as written is the same 404 without implying anything was tried. */
function joinWithinBase(dirRel: string, rel: string): string | null {
  const out: string[] = [];
  for (const segment of `${dirRel}/${rel}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.pop() === undefined) return null;
      continue;
    }
    out.push(segment);
  }
  return out.length ? out.join("/") : null;
}

/** The part of `src` that names a file: before any query or fragment, percent-decoded. Null when
 *  the escapes are malformed, since there is then no file name to resolve. */
function filePart(src: string): string | null {
  const end = src.search(/[?#]/);
  try {
    return decodeURIComponent(end === -1 ? src : src.slice(0, end));
  } catch {
    return null;
  }
}

/** The raw-route URL for a relative image `src`, or null to leave it as written. */
export function servedImageSrc(src: string, doc: ServedDoc): string | null {
  if (src === "" || NOT_FILE_RELATIVE.test(src)) return null;
  const rel = filePart(src);
  const resolved = rel === null ? null : joinWithinBase(doc.dirRel, rel.replace(/\\/g, "/"));
  if (resolved === null) return null;
  return `${RAW_ROUTE}?cwd=${encodeURIComponent(doc.base)}&path=${encodeURIComponent(resolved)}`;
}
