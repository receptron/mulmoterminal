# fix: a path right after a full-width colon is not linked (#3268)

## Problem

`PATH_CHARS` in `src/composables/terminalFilePathLinks.ts` treats ASCII `:,;` and `、。` as
separators but not their full-width forms. So in `できたこと：src/a.md` the whole run, Japanese
included, is linked, and in `できたこと：D:\x\a.md` the drive letter is swallowed into the word
before it, so with `windowsPaths` nothing is linked at all.

Reproduced on main with `findFilePathLinks` before the change.

## Fix

Add `：；，！？` (U+FF1A, U+FF1B, U+FF0C, U+FF01, U+FF1F) to the excluded characters in
`PATH_CHARS`, as the issue proposes. The class is the only place this separator set lives.

## Trade-off

A file name that itself contains one of these characters now splits there — the same trade
already made for `、。` and the full-width brackets.

## Tests

`test/src/terminalFilePathLinks.spec.ts`: a `/` path after `：` with and without a space, several
paths separated by `！？，；、`, and a drive path after `：` with `windowsPaths`.
