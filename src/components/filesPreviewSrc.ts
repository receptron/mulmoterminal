// WHICH REVISION the Files pane's Markdown preview asks for, with none of the pane in it.
//
// Preview is an iframe onto a route that renders the file ON DISK, so the URL is the whole of
// what it shows — and the URL carried no revision, which is why a file rewritten under it left
// the browser serving the rendering it already had (#2136).
//
// WHICH VIEW is up is a different question and lives in `filesPreviewMode.ts` (#2137).
import { browseQuery } from "./filesPaneApi";
import { MD_PREVIEW_EMBED_ON, MD_PREVIEW_EMBED_PARAM } from "../../common/mdPreviewMessage";
import type { PreviewTheme } from "../../common/previewTheme";

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
 *  file. Only THIS url carries it — the new tab a clicked `.md` opens builds its own, and keeps
 *  the document that has no script in it at all. */
export function previewQuery(cwd: string | null, pathRel: string, version: string | null, theme: PreviewTheme | null = null): string {
  const params = new URLSearchParams(browseQuery(cwd, pathRel));
  if (version) params.set("v", version);
  params.set(MD_PREVIEW_EMBED_PARAM, MD_PREVIEW_EMBED_ON);
  // The app's theme (#2263). Part of the URL for the same reason `v` is: a theme change then changes
  // the src, and the frame fetches the document again in the new colours.
  if (theme) Object.entries(theme).forEach(([param, colour]) => params.set(param, colour));
  return params.toString();
}
