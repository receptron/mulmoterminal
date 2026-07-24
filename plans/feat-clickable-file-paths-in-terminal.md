# feat: click a file path in terminal output to preview it in the browser

Issue: https://github.com/receptron/mulmoterminal/issues/778

## User prompt

> llm の書き出しで
> `📎 ↑ hero.gif を添付（~/ss/mulmoterminal-marketing/assets/media/hero.gif）`
> みたいになったときに、このファイルをブラウザ上でみたい。できる？

Confirmed scope:
- **Serving scope:** files **within the session's own cwd** only.
- **Trigger UX:** **auto-linkify** the path in the terminal; click opens a new tab.
- Proceed: create issue + plan + implement + PR.

## Problem

The agent's terminal output is raw `xterm.js` text. A printed file path is inert — only
`http/https` URLs are linkified (`WebLinksAddon`, `useTerminalConnections.ts:220`). There is no
way to click a produced asset (gif/image/video/pdf) and view it.

## Design

### Server — extend `GET /api/files/raw` (`server/backends/files.ts`)

Today the route is confined to the **workspace root** and rejects absolute / `..` paths. The
example path lives in a **sibling repo** (the session's cwd), outside the workspace root, so the
route must become session-cwd aware.

- Add optional `?cwd=<abs session dir>`. When present, the serving base is that dir (absolute +
  existing, else fall back to workspace root); when absent, behaviour is unchanged (backward
  compatible with the collection plugin's `<img src="/api/files/raw?path=...">`).
- Tilde-expand the `path` param (`~` / `~/…` → `os.homedir()`), then contain it within the base:
  lexical (`containedPath`) **and** symlink-safe (`realContainedWithin`). Escape → `403`.
- Reuse the containment helpers currently in `files-browse.ts`. Extract them into a new pure/FS
  module `server/files/pathContainment.ts` (`resolveBase`, `containedPath`,
  `realContainedWithin`, new `expandTilde`) so `files.ts` doesn't import the `marked`-carrying
  browse module. `files-browse.ts` re-imports from there.

### Client — detection (pure) + link provider (glue)

1. **Pure, unit-tested detector** `src/composables/terminalFilePathLinks.ts`
   `findFilePathLinks(line: string): { start: number; end: number; text: string }[]` (string
   indices). A token is a run of path chars (excludes whitespace, quotes, ASCII + full-width
   brackets, `:`, `,`, `;`, `、`, `。`) that:
   - contains at least one `/`,
   - ends in a file extension (`.<1-8 alnum>`, trailing `.` trimmed), and
   - is anchored (`/`, `~/`, `./`, `../`) **or** has ≥2 path separators (cuts prose like
     `read/write.md`).

2. **xterm link provider** in `useTerminalConnections.ts` (registered next to `WebLinksAddon`):
   - Read the session cwd from the connection (`c.knownCwd`); no cwd → no links.
   - Build the buffer line's string + a per-char cell-column map (wide-char / CJK aware) so the
     detector's string ranges map to correct terminal columns.
   - On click, open `/api/files/raw?cwd=<enc cwd>&path=<enc detected path>` in a new tab
     (`window.open(url, "_blank", "noopener")`). The server does tilde-expansion + containment.

## Tests

- `test/src/terminalFilePathLinks.spec.ts` — detector: the issue's example, absolute / `~/` /
  relative, extension boundary, full-width `（）`/Japanese-period termination, prose rejection,
  multiple paths per line, empty / no-match. (Fail-when-broken verified.)
- `test/server/files/pathContainment.spec.ts` — `expandTilde` (`~`, `~/x`, `~user` left alone,
  non-tilde), `containedPath` escape/ok.
- `test/server/backends/files.spec.ts` — extend: `?cwd=` serves an in-cwd file (incl. a `~/`
  path that resolves inside cwd), rejects an out-of-cwd path (403), no-`cwd` behaviour unchanged.

## Out of scope (v1)

- Paths wrapping across terminal rows (single-line detection).
- Files outside the session cwd.
- Windows drive-letter paths (`C:\…`).

## Verification

- `yarn format && yarn lint && yarn build && yarn typecheck && yarn test`.
- `/verify` in the running app: print the example line in a session and click the path.
