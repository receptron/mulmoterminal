# fix: /artifacts/html is contained through links too (#3310)

## Problem

`GET /artifacts/html/<rest>` (`mountHtmlPreviewRoute`, `server/backends/plugins/html.ts`) checked that
the path stays inside `<workspace>/artifacts/html` only lexically and then streamed it by name. A link
under the folder was followed wherever it pointed, and since the `.html` rule looks at the requested
name, a link named `x.html` served any file the server could read, as `text/html`. Reproduced on main
with a scratch-HOME server: a link to an outside `.txt` and a link to an outside folder both answered
200 with the outside contents.

## Change

- The page is opened with `openVerifiedWithinScope` from `@mulmoclaude/core/files`, anchored at the
  workspace's realpath with `artifacts/html` as the scope. The folder is re-resolved under the
  workspace on every request, and the handle is proven after opening to be the file the folder holds
  now, so a link out, a folder swapped for one, or the folder itself replaced by a link is refused.
- Only a regular file is served; a folder named like a page is a 404.
- A refusal is the 404 of a missing page, as MulmoClaude's `artifactMount.ts` answers.
- The page streams from the verified handle (`streamHandleToResponse`), which closes it when done or
  when the response closes early. The preview headers are set by one function shared with
  `sendHtmlDocument`, so the CSP still cannot be left off.

The lexical check and the `.html` check stay in front, with their 403 and 400.

## Behaviour that changes

A link under `artifacts/html` that points outside it is no longer served. One that stays inside still is.

## Not changed

- `/htmlfile/<scope>/…` has no containment root by design, and checks `.html` on the requested name.
  That is a separate question.
- Images and media referenced by a page are not served from this route, as before.

## Verification

- `test/server/backends/plugins/artifactsHtmlContainment.spec.ts`: a page inside and a link inside are
  served; a link named `.html` to an outside `.txt`, a page through a folder link out, a folder named
  like a page, and a folder swapped for a link out after the check all answer 404 with none of the
  outside text. Against the code before this change, the two link cases served the outside contents.
- Removing the regular-file check makes the folder case fail.
- `test/server/backends/plugins/html.spec.ts` passes unchanged (CSP, escapes, missing page).
