# Files pane header overflows the pane (#2983)

## Reproduced

On the real app (a built `dist/` served by this checkout's server on an isolated HOME, Playwright
against it), a shell cell enlarged, the Files pane opened from the path menu, `README.md` open:

- at the default split width the header's content is wider than the header itself, and the last
  four buttons — search in files, insert `@file`, Reload tree, Close files — end past the pane's
  right edge, which is the window's edge;
- after narrowing the pane with its splitter, more of the row is lost and the pane cannot be closed
  from its own header.

The measurement is `header.scrollWidth` against `header.clientWidth`, and the Close button's
`getBoundingClientRect().right` against the pane's. The user's screenshot shows the same row with a
larger UI font: `History` squeezed onto two lines, everything after `@` gone.

## Cause

`src/components/FilesPane.vue`: the `<header>` is one flex row that cannot wrap. A Markdown file
shows every control the header has, and at their minimum widths they need more room than the pane
offers, so the row overflows to the right. #2899 stopped the PANE growing past the window on one
long line (`rightPaneStyle`); it does not stop the header overflowing the pane.

## Fix

The header wraps (`flex-wrap`), with a row gap so a second line reads as one. `justify-end` keeps
the wrapped buttons at the right edge, where the row has always ended; the title stays on the left
because the spacer after it still takes the first line's free space. Nothing is hidden, collapsed or
scrolled: every control stays reachable at every width the splitter allows, which is what the
Collections pane already guarantees for its own close.

Not changed: which buttons the header shows, their order, the full-screen `/files` view (the same
component, wide enough not to wrap).

## Verified

- the same real-app run after the fix: the Close button's right edge is inside the pane at the
  default width and after narrowing; the header's content no longer exceeds its width; the pane
  closes from its header;
- `test/src/components/filesPaneHeaderWrap.spec.ts` mounts the pane and pins that the header is a
  wrapping row holding the close button — it cannot measure layout (jsdom), so the browser run above
  is the evidence for the geometry.
