# refactor: remove jscpd-reported duplicate code

`jscpd` (min 5 lines / 50 tokens) over `src server common plugins test` reports **173 clones**,
1666 duplicated lines (2.43%). 79 of those clones are in production code; the rest are in
`*.spec.ts` files.

Goal: eliminate the duplication that represents a real missing abstraction, and leave alone the
clones that are merely coincidental shape. A false abstraction is worse than the duplication it
removes.

## Scope

Shipped as several small PRs, one per cluster, so each stays reviewable.

| # | Cluster | Dup lines | Approach |
|---|---------|-----------|----------|
| 1 | `server/backends/collections.ts` (self) | 107 | load-or-404 helper, error-guard route wrapper, shared store-failure mapper |
| 2 | `CommandCell.vue` ↔ `LauncherCell.vue` | 105 CSS + 13 HTML + 11 TS | extract the shared cell-header chrome |
| 3 | `RunMenu.vue` ↔ `SkillMenu.vue` | 50 CSS + 25 TS | shared dropdown composable + stylesheet |
| 4 | `GuiPanel.vue` ↔ `ToolsPane.vue`, `NotificationBell.vue` ↔ `RemoteHostControl.vue` | 31+29 CSS, 19+11 TS | shared composable + stylesheet |
| 5 | `server/config/dir-config.ts` ↔ `src/composables/useDirConfig.ts` | 19 | share the isomorphic part |
| 6 | `server/index.ts` (self) | 65 | extract the repeated route shapes |

## Out of scope

- **`*.spec.ts` clones (94 of the 173).** Test duplication is usually deliberate: each test reads
  top-to-bottom without the reader chasing a shared fixture. Not worth collapsing.
- Clones under ~15 lines between unrelated modules (e.g. two overlays that happen to share a
  scrollbar rule) — coincidental shape, no shared concept.

## Constraint

Pure refactor: no behavior change. Each PR must keep `yarn lint`, `yarn typecheck` and `yarn test`
green (baseline: 131 files / 1438 tests).

Note: `yarn typecheck:server` fails on `server/infra/web-push.ts` **on `main` already** — an
upstream `@mulmobridge/web-push` type drift, unrelated to this work.
