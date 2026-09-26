# fix: an external link in the Markdown preview navigates inside the iframe (#2259)

## Problem
The Files pane's Preview is an `<iframe sandbox="allow-scripts">` showing `/api/files/browse/md?…&embed=1`
under `sandbox allow-scripts; script-src 'nonce-…'`. With no `allow-popups` and no
`allow-top-navigation`, a click on `[x](https://www.youtube.com/…)` loads the site inside the
frame. Sites that refuse framing show "refused to connect", and the rest leave the reader stuck
there.

## Measured before designing (real Chrome, popup blocker ON; a no-gesture control was blocked)
- A click in the sandboxed frame that posts to the parent lets the parent's `window.open` through.
  The click's user activation reaches the host, so the sandbox needs no `allow-popups`. This
  settles the open question in the issue.
- The issue's step 1 (`target="_blank"` on external links in `renderMd`) was **not** done. The
  plain document (the new tab a clicked `.md` opens) is served under CSP `sandbox` without
  `allow-popups`, and there `target="_blank"` opens nothing. Today that link navigates the tab,
  so adding it would break a link that works.

## Fix
- `common/mdPreviewMessage.ts`: a `navigate` message, and `externalHref`, which accepts only an
  absolute http(s) URL. The document is unsanitised, so a `javascript:` or `file:` href must never
  reach `window.open`.
- `server/files/mdPreviewEmbed.ts`: the reporter catches a click on an `a[href]` whose attribute
  as written is `http(s)://…`, prevents the default and posts `navigate`. Relative links (#2268)
  and anchors keep their default.
- `src/composables/useMdPreviewScroll.ts`: the host opens a `navigate` from its own frame with
  `window.open(href, "_blank", "noopener,noreferrer")`.

## Spec
- `mdPreviewMessage.spec.ts`: http(s) accepted; `javascript:`, `file:`, `data:`, relative, `#`,
  empty and non-strings refused
- `useMdPreviewScroll.spec.ts`: its own frame's `navigate` opens; another window's does not
- `mdPreviewEmbed.spec.ts`: the reporter carries the click handler, and its href test accepts only
  absolute http(s). The script can't be run under this repo's vitest jsdom, which executes no
  `<script>`, so behaviour was checked in a real browser instead.
