// Where a link clicked in the Markdown preview points (#2268): a file under the pane's root, a
// place above it, or nothing the pane opens. Pure, because every case is about a path resolving
// somewhere other than where it was written — `../` from a nested document, an encoded space, a
// fragment on another file — which a DOM test would not reach.
import { OTHER_SCHEME_HREF } from "../../common/mdPreviewMessage";
import { isOutsidePath } from "./filesOutsidePath";

export type PreviewLinkTarget =
  /** A file under the pane's root, relative to it. */
  | { kind: "file"; path: string }
  /** A path that climbs above the pane's root. Not opened: the pane only reaches what it holds. */
  | { kind: "outside" }
  /** Nothing to open — an anchor, another scheme, a folder, or an href that is not a path. */
  | { kind: "none" };

const NONE: PreviewLinkTarget = { kind: "none" };
/** Empty, or ending in `/`, `.` or `..` — a folder, which the pane has no tab for. */
const NAMES_A_FOLDER = /(?:^|\/)\.{0,2}$/;

/** The href with its query and fragment removed and its escapes decoded, or null when an escape is
 *  malformed. The fragment names a heading in the OTHER file, which the pane has no way to reach. */
function pathPart(href: string): string | null {
  const cut = href.search(/[?#]/);
  try {
    return decodeURIComponent(cut < 0 ? href : href.slice(0, cut));
  } catch {
    return null;
  }
}

/** Walk `segments` from `base`, or null when a `..` climbs past the root. */
const walk = (base: string[], segments: string[]): string[] | null =>
  segments.reduce<string[] | null>((at, segment) => {
    if (at === null || segment === "" || segment === ".") return at;
    if (segment !== "..") return [...at, segment];
    return at.length === 0 ? null : at.slice(0, -1);
  }, base);

/** `href` as written in the document at `docPath` (relative to the pane's root). A leading `/` is
 *  the root itself, as a repository's own README links read on the forge that hosts it. A document
 *  OUTSIDE the root, open on its own (#3238), reaches no other file: every path in it is outside. */
export function previewLinkTarget(docPath: string, href: string): PreviewLinkTarget {
  if (href === "" || href.startsWith("#") || OTHER_SCHEME_HREF.test(href)) return NONE;
  const written = pathPart(href);
  if (written === null || NAMES_A_FOLDER.test(written)) return NONE;
  if (isOutsidePath(docPath)) return { kind: "outside" };
  const docDir = written.startsWith("/") ? [] : docPath.split("/").slice(0, -1);
  const segments = walk(docDir, written.split("/"));
  if (segments === null) return { kind: "outside" };
  return segments.length === 0 ? NONE : { kind: "file", path: segments.join("/") };
}
