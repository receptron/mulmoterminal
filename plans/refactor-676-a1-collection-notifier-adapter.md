# refactor: extract collection notifier adapter pure helpers (#676 A1)

## Background

`server/backends/collectionWatchers.ts` carries the cross-app-parity requirement that
its notification adapter stay **byte-identical** to MulmoClaude's counterpart
(`server/workspace/collections/notifications.ts`): both apps share one notifier file
(`<ws>/data/notifier/active.json`), so a record's bell must round-trip through either
app's `readEntry` with the same `legacyId` or a duplicate bell appears. The wrap/unwrap
logic that enforces this was buried in the module as un-exported, un-tested functions —
exactly the code where a silent divergence produces double bells.

Issue #676 priority A1 asks to extract these pure functions into their own file and pin
them with tests, without changing behavior.

## Scope

Extract, verbatim (behavior unchanged), into a new sibling file
`server/backends/collectionNotifierAdapter.ts`:

- `LegacyNotifierPluginData` interface (the bell marker shape)
- `isLegacyNotifierPluginData(value): value is LegacyNotifierPluginData`
- `buildNavigateTarget(slug, itemId): string`
- `priorityToSeverity(priority): NotifierSeverity`
- `buildPluginData({ legacyId, slug, itemId, priority }): LegacyNotifierPluginData`
- `readEntry(pluginData): { legacyId, priority } | null`

`collectionWatchers.ts` keeps the I/O boundary: it imports the helpers and assembles
`adapter: CollectionNotificationAdapter` (still owning `pluginPkg: "todo"`, the `log`
object, and `startCollectionCompletionWatchers`).

Types `CollectionNotificationAdapter` / `CompletionPriority` come from
`@mulmoclaude/core/collection-watchers`; `NotifierSeverity` from
`@mulmoclaude/core/notifier` (used only to annotate `priorityToSeverity`'s return —
previously supplied by contextual typing on the inline adapter).

## Tests

`test/server/backends/collectionNotifierAdapter.spec.ts` (vitest, node env):

- `buildPluginData` -> `readEntry` priority round-trip (high stays high; anything else
  stored as normal)
- `readEntry` returns null for non-marker input (null / non-object, legacy marker
  missing, non-string `legacyId`, non-string `kind`)
- `isLegacyNotifierPluginData` truth table (true only for `legacy:true` + string
  `legacyId` + string `kind`)
- `buildNavigateTarget`: normal slug -> `/collections/<enc>?selected=<enc>`; empty
  itemId drops the query; `.` / `..` -> `/collections`; reserved chars percent-encoded
- `priorityToSeverity`: high -> urgent, normal -> nudge

### Mutation checks (confirmed the tests fail against broken code, then restored)

- Removed the `.` / `..` fallback in `buildNavigateTarget` -> "falls back to the index
  for dot-segment slugs" went red.
- Inverted the priority decision in `readEntry` (`=== "high"` -> `!== "high"`) -> both
  round-trip tests went red.
- Swapped the `priorityToSeverity` branches -> both mapping tests went red.

## Verification

- `prettier --write` + `eslint` on the changed/new files: clean
- `yarn typecheck` (vue-tsc -b), `yarn typecheck:server`, `yarn typecheck:test`: all pass
- `vitest run test/server/backends`: 27 files / 368 tests green
