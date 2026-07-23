# refactor(#676 A5): extract WikiIndexView tag-filter rules into a pure, testable module

Part of #676. Priority-A item A5.

## Problem

`src/components/WikiIndexView.vue` held the whole tag-filter / chip decision set inline in
its `computed` group (`tagCounts` → `meaningfulTags` → `cutoffTags` → `visibleTags` →
`filtered`). Those rules — count aggregation, singleton drop, count-desc/name-asc ordering,
an adaptive cutoff that keeps equally-popular tags together (not a fixed `slice`), restoring
a cutoff-hidden selected tag at the tail, and the AND filter — could only be reached by
mounting the component, so none of them were tested.

## Change

Extract the rules into a new same-directory pure module `src/components/wikiTagFilter.ts`
and reduce the `.vue` to `computed` calls into it. Behavior is unchanged (1:1 move).

Public API:

- `tagCounts(entries: WikiPageEntry[]): Map<string, number>` — per-tag page counts.
- `filterChips(entries, selected: ReadonlySet<string>, target = TARGET_FILTER_CHIPS): [string, number][]`
  — meaningful ranking → adaptive cutoff → restore cutoff-hidden selected tags at the tail.
- `filterEntriesByTags(entries, selected: ReadonlySet<string>): WikiPageEntry[]` — AND filter;
  empty selection matches everything.

`TARGET_FILTER_CHIPS = 20` is kept as a named constant and used as `filterChips`'s default
`target`. `WikiPageEntry` comes from `@mulmoclaude/core/wiki`. The ranking helpers copy the
count entries before sorting, so the caller's `props.entries` are never mutated.

Internally `filterChips` is split into small named helpers (`rankMeaningfulTags`,
`adaptiveCutoff`, `appendHiddenSelected`) so each rule reads on its own.

## Tests

`test/src/components/wikiTagFilter.spec.ts`:

- `tagCounts`: aggregation, empty entries, no mutation of tag arrays.
- singleton (count == 1) tags dropped from chips.
- count desc, then name asc on ties.
- **adaptive cutoff pin**: the 20th and 21st tags tie → both kept (bar length exceeds the
  target); a second case pins the same with an explicit small `target`. Both fail if the
  cutoff is replaced by `slice(0, target)`.
- cutoff-hidden **selected** tag restored at the tail with count fallback 1 (both a page
  singleton and a tag absent from every page); multiple restored tags sorted by name.
- AND filter across multiple selected tags; empty selection returns all; single tag; and a
  selection no entry satisfies returns `[]`.

## Mutation check

Replacing `adaptiveCutoff` with `return ranked.slice(0, target)` turned both boundary-tie
pin tests red (default-target length-22 test and the small-target test) while the other 11
stayed green; reverted after confirming.

## Verification

`prettier --write` + `eslint` on the touched files; `yarn typecheck`, `yarn typecheck:server`,
`yarn typecheck:test`; `vitest run` on the new spec.
