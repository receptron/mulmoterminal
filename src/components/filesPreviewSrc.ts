// WHICH REVISION the Files pane's Markdown preview asks for, with none of the pane in it.
//
// Preview is an iframe onto a route that renders the file ON DISK, so the URL is the whole of
// what it shows — and the URL carried no revision, which is why a file rewritten under it left
// the browser serving the rendering it already had (#2136).
//
// WHICH VIEW is up is a different question and lives in `filesPreviewMode.ts` (#2137).
import { browseQuery } from "./filesPaneApi";
import { MD_PREVIEW_EMBED_ON, MD_PREVIEW_EMBED_PARAM, MD_PREVIEW_TOKEN_PARAM } from "../../common/mdPreviewMessage";
import type { PreviewTheme } from "../../common/previewTheme";
import { filesPageUrl } from "../../common/filesPage";
import type { FilePreviewKind } from "./filePreviewKind";

/** The version of the open file ON DISK, as the pane currently knows it.
 *
 *  Preview follows disk even while the buffer is dirty: it is the server's rendering of the
 *  file, so it already showed something other than the buffer before the first keystroke. A
 *  conflict holds the version the poll found on disk; `baseVersion` holds it whenever the
 *  buffer was clean enough to adopt the new content. */
export function diskVersion(baseVersion: string | null, conflict: { version: string | null } | null): string | null {
  return conflict ? conflict.version : baseVersion;
}

/** The `?cwd=&path=&v=&embed=1` the preview iframe asks for.
 *
 *  `/api/files/browse/md` resolves `cwd` and `path` and reads only one thing more, so `v` reaches
 *  no server logic. It is there so the src CHANGES when the file does — the only thing that makes
 *  a browser refetch a document it already has.
 *
 *  `embed` is the one the server does read (#2157): it asks for the same rendering with the
 *  scroll reporter in it, under a policy that lets that one script run and still nothing from the
 *  file. The new tab a clicked `.md` opens builds its own URL without it, and gets the document
 *  with the toolbar that switches to the source and copies (#3238); the pane has those already. */
export function previewQuery(
  cwd: string | null,
  pathRel: string,
  version: string | null,
  theme: PreviewTheme | null = null,
  token: string | null = null,
): string {
  const params = new URLSearchParams(browseQuery(cwd, pathRel));
  if (version) params.set("v", version);
  params.set(MD_PREVIEW_EMBED_PARAM, MD_PREVIEW_EMBED_ON);
  // The document stamps what it says with this, and the host hears nothing without it (#2515).
  if (token) params.set(MD_PREVIEW_TOKEN_PARAM, token);
  // The app's theme (#2263). Part of the URL for the same reason `v` is: a theme change then changes
  // the src, and the frame fetches the document again in the new colours.
  if (theme) Object.entries(theme).forEach(([param, colour]) => params.set(param, colour));
  return params.toString();
}

/** What the Preview frame loads for each kind (#2269), with the disk version in it for `v`'s reason
 *  above. Markdown is rendered by the server; an HTML file is the page itself, by PATH so what it
 *  links relatively resolves beside it (common/filesPage.ts); an SVG is the raw image. With no
 *  root to name, an HTML page has no URL — its route serves only under an authorised base. */
export function previewSrcFor(
  kind: FilePreviewKind,
  cwd: string | null,
  pathRel: string,
  version: string | null,
  theme: PreviewTheme | null,
  token: string | null = null,
): string {
  if (kind === "markdown") return `/api/files/browse/md?${previewQuery(cwd, pathRel, version, theme, token)}`;
  if (kind === "svg") return rawFileSrc(cwd, pathRel, version);
  if (kind === "table") return `/api/files/browse/table?${renderedQuery(cwd, pathRel, version, theme)}`;
  if (kind === "json") return `/api/files/browse/json?${renderedQuery(cwd, pathRel, version, theme)}`;
  if (!cwd) return "";
  const page = filesPageUrl(cwd, pathRel);
  return version ? `${page}?v=${encodeURIComponent(version)}` : page;
}

/** The table and JSON routes' query: `v` and the theme for `previewQuery`'s reasons, and `embed`
 *  for one of them — it says this is the pane asking, so the document comes without the tab's
 *  toolbar (#3238). Neither document carries a script to report with, so the wire's token stays
 *  off these. */
function renderedQuery(cwd: string | null, pathRel: string, version: string | null, theme: PreviewTheme | null): string {
  const params = new URLSearchParams(browseQuery(cwd, pathRel));
  if (version) params.set("v", version);
  params.set(MD_PREVIEW_EMBED_PARAM, MD_PREVIEW_EMBED_ON);
  if (theme) Object.entries(theme).forEach(([param, colour]) => params.set(param, colour));
  return params.toString();
}

/** The raw route's URL for the file — an SVG's Preview, and the picture a raster image shows as. */
export function rawFileSrc(cwd: string | null, pathRel: string, version: string | null = null): string {
  const params = new URLSearchParams(browseQuery(cwd, pathRel));
  if (version) params.set("v", version);
  return `/api/files/raw?${params.toString()}`;
}
