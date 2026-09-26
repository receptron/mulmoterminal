# fix: relative images in the Markdown preview 404 (#2261)

## Problem
The rendered document is served from `/api/files/browse/md?…`, so `![](../images/x.png)`
resolved against `/api/files/browse/` and every relative image 404'd. `renderMd` passed
`marked.parse` output through untouched.

## Fix
- `server/files/mdImageSrc.ts` (pure): `servedImageSrc(src, { base, dirRel })` rewrites a relative
  `src` to `/api/files/raw?cwd=<base>&path=<resolved>`, resolved against the document's own
  directory. Left as written: a scheme (`https:`, `data:`), a root- or protocol-relative path, `#`
  or `?` references, an empty `src`, malformed percent-escapes, and anything that climbs above
  the base (the raw route would refuse it; it stays a plain 404).
- `files-browse.ts`: the rendered routes pass the document's location (`ServedDoc`) to the
  renderer. It is measured lexically from the request, because a browser resolves `src` against
  where the document appears to be. The md renderer uses a per-request `Marked` whose
  `walkTokens` rewrites image tokens. This covers both the plain document and the `?embed=1` one.

The raw route's `authorizedServingBase` is unchanged, so images resolve only when the base is the
workspace or a live session's directory, as for any other raw URL. Raw `<img>` HTML inside the
Markdown is not rewritten.

## Spec
- `test/server/files/mdImageSrc.spec.ts`: rewritten and left-alone cases
- `test/server/files/files-browse.spec.ts`: the route rewrites `../images/x.png` in the plain and
  embed documents, leaves a climb above the base and an https URL alone
