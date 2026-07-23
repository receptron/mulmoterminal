# refactor(#676 B5): extract the `[[wiki link]]` click resolution into a pure, testable module

Part of #676. Priority-B item B5.

## Problem

`src/components/WikiPageView.vue`'s `activateLink` resolved a clicked `[[wiki link]]`'s raw
target to a slug inline: graph resolution (`resolveLinkTarget`) first, then a `wikiSlugify`
fallback gated by `isSafeWikiSlug`, returning null (skip navigation) when nothing safe
resolves. The individual functions come from `@mulmoclaude/core/wiki` and are already tested,
but this **composition** — the fallback order, the `props.graph ?` guard, and the safety gate
on the fallback — could only be reached by mounting the component and clicking, so it was
untested. A "simplification" that dropped the safety gate or reordered the fallback would
silently change which page a click opens.

## Change

Extract the composition into a new same-directory pure module
`src/components/wikiClickTarget.ts` and reduce `activateLink` to the DOM read + navigate. The
DOM operations (`el.getAttribute("data-page")`, `wikiGotoPage`) stay in the `.vue`. Behavior
is unchanged (1:1 move).

Signature, faithful to what the `.vue` currently passes:

```ts
resolveWikiClickTarget(rawTarget: string, deps: {
  graph: WikiGraph | null;
  fileSlugs: ReadonlySet<string>;
  slugByTitle: ReadonlyMap<string, string>;
}): string | null
```

`deps.graph` reproduces the original `props.graph ? resolveLinkTarget(...) : null` guard
exactly (the resolver is skipped when the graph is null); `fileSlugs` / `slugByTitle` are the
same derived maps the `.vue` already computed. The three core functions are imported directly
(they are the already-tested primitives; the composition is what this module pins).

## Tests

`test/src/components/wikiClickTarget.spec.ts` (fixtures built from real graph nodes so
`fileSlugs` / `slugByTitle` stay internally consistent, exercised against the real core
functions):

- graph resolution succeeds → returns that slug (direct slug match).
- graph title-match returns a slug that differs from the plain slugify form
  ("Meeting Notes" → "meeting-notes-2026") → pins graph-first ordering.
- graph misses → safe `wikiSlugify` fallback returned ("Unknown Page" → "unknown-page").
- graph misses and fallback is unsafe (non-ASCII "日本語" slugifies to "") → null.
- graph is null but `fileSlugs` / `slugByTitle` are populated → resolver is skipped, safe
  fallback returned (pins the `deps.graph ?` guard).
- graph is null and fallback unsafe → null.

## Mutation check

- Dropping the safety gate (`return isSafeWikiSlug(fallback) ? fallback : null` →
  `return fallback`) turned the two unsafe-fallback tests red (`""` instead of `null`); the
  other four stayed green.
- Reversing the fallback order (try `wikiSlugify` before the graph resolver) turned the
  title-match ordering test red (`"meeting-notes"` instead of `"meeting-notes-2026"`).

Reverted after confirming each.

## Verification

`prettier --write` + `eslint` on the touched files; `vue-tsc -b`, `tsc -p tsconfig.server.json`,
`vue-tsc -p tsconfig.test.json --noEmit` + `tsc -p tsconfig.test-server.json`; `vitest run` on
the new spec (6 passing).
