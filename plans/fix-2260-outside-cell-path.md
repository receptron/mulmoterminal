# fix: clicking a path outside the cell's directory returns 403 (#2260)

## Problem
A clicked terminal path outside the cell (`/tmp/report.md`, `~/Downloads/x.md`, `../other/a.ts`)
was sent to the file routes with the CELL's cwd as the base. The routes contain `path` within
`cwd`, so they answered `path escapes the project root`. The browse routes accept any existing
directory as a base, so the same file opens fine when the base is its own directory.

A sibling found while tracing it: `pathWithinCwd` treated `~/…` as cwd-relative (the browser
cannot expand `~`), so the pane claimed such a click and then failed the same way.

## Fix
- `pathWithinCwd` returns null for a `~` path. The client cannot show it is inside the cwd. The
  cost is that a `~` path which IS inside the cell opens in a tab instead of the pane.
- New pure `rebaseOutsideCwd(token, cwd)` turns a path outside the cwd (absolute, `~`, or a
  `..` climb) into `{ base: its directory, rel: its name }`.
- The link provider's `activate` uses that pair for both the URL route and the Files view.
- `resolveBase` on the server expands a leading `~`, so `cwd=~/Downloads` is a real base.

Unchanged: the raw route's `authorizedServingBase`, so images, PDFs and video outside the cell
are still refused, as before.

## Spec
- `pathWithinCwd.spec.ts`: `~` is not inside; `rebaseOutsideCwd` cases (absolute, root, `~`, `..`,
  climb past root, prefix sibling, dot segments, Windows cwd; nulls for inside/dir/`~`/no cwd)
- `terminalFilePathLinkProvider.integration.spec.ts`: an outside `.md` and `~` `.md` open against
  their own directory; outside source goes to the Files view rooted there
- `pathContainment.spec.ts`: `resolveBase` expands `~`
