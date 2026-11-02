# fix: link a path holding a space whole when it is enclosed (#3246)

## Problem

Whitespace ends a path token, so `/Users/me/My Docs/a.md` linked only `Docs/a.md`, which a click
opened as `<cwd>/Docs/a.md` — not found, or a different file of the same name. Quotes and brackets
did not help: they are token boundaries too, so `Read(/Users/me/My Docs/a.md)` gave the same tail.

## Fix

`findFilePathLinks` first looks for enclosed spans — `"…"`, `'…'`, `` `…` ``, `(…)`, `（…）`, `「…」` —
and links one whole when its text reads as ONE path:

- it contains a space (a span without one is already handled by the token rule),
- it is anchored: `/` (not `//`), `~/`, `./`, `../`, and with `windowsPaths` a drive or `\` forms,
- it ends in an extension, optionally followed by a location (`:12:3`, `(12,5)`),
- no earlier space-separated word ends in an extension (`./a.md and ./b.md` is two paths),
- no later word starts an argument (`-`, `/`, `~/`, `./`), so a command line is not joined,
- the last word holds a separator: a space in the FILE name (`/usr/bin/grep foo.md`) reads the same
  as a command, so only a space in a folder name joins,
- a location printed after the closer (`Read(…):12`) joins the range,
- it does not contain its own opener (a nested bracket is not one span).

Token links that start inside an accepted span are dropped; everything else is the token rule as before.

## Left out, on purpose

- An unenclosed path with a space still links only its tail. Telling it apart needs a guess about
  the word before (`ls /tmp src/a.ts` is two arguments), and a wrong guess removes a correct link.
- A file name holding a space (`"/x/My File.md"`): indistinguishable from a command; not linked, as on main.
- Prose in brackets that starts with a path and ends in one (`(/tmp has out/a.md)`) is still joined:
  nothing in the text tells it apart from a folder named `tmp has out`.
- An unanchored enclosed path (`"My Docs/a.md"`): the words before the first separator are as likely
  to be prose.

## Behaviour on lines without such a span

Unchanged: the old `findFilePathLinks` was run beside the new one over generated lines (spaces,
quotes, brackets, separators, drives, locations, URLs), both with and without `windowsPaths`. Every
difference is an accepted span replacing the tokens inside it.
