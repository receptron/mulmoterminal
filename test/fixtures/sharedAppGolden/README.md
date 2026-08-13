# The `{tier}/config` wire contract, as documents

One declaration and the two documents it projects to. **The same three files exist in
mulmoserver at `test/fixtures/sharedAppGolden/`.** This repository writes these documents;
that one reads them. Neither side type-checks the other — mulmoserver's reader takes
`unknown` and drops what it cannot parse — so these files are what makes the two agree.

| file | what it is |
| --- | --- |
| `app.json` | the author's declaration, the input |
| `member.config.json` | `apps/{aid}/member/live:config`, what everyone `staffOf` admits reads |
| `roster.config.json` | `apps/{aid}/roster/live:config`, what everyone `listedIn` admits reads |

## Who checks what

- **Here**: `test/server/backends/appViewGolden.spec.ts` regenerates both documents from
  `app.json` and diffs. A rename, a dropped field, or a reordered key fails.
- **mulmoserver**: `test/composables/test_appViewGolden.ts` feeds the same two documents to
  `writeOf` and `capabilitiesFor` and asserts which capabilities come back for which
  address. A field this side stops writing shows up there as a capability that
  disappeared.

That pair is the thing neither repository had: proof that what is written is what is read.
`firestore.rules` is still the authority over what is *allowed* — none of this grants
anything — and mulmoserver `test/rules/rules_publish.ts` is what proves the OTHER
projection (`config/public`, `apps/{aid}`) agrees with the rules.

## Updating

```
UPDATE_GOLDEN=1 yarn vitest run test/server/backends/appViewGolden.spec.ts
```

then **copy the changed files into mulmoserver** and run its suite. The copy is by hand
today; how the two are kept in step is
[receptron/mulmoterminal#1673](https://github.com/receptron/mulmoterminal/issues/1673),
and the reasoning is in `plans/refactor-shared-app-wire-contract.md`.

The declaration is deliberately one app carrying every distinction at once — a roster with
all five roles, a collection with a status field and an assignee field and mail, a
participant who reads one collection whole and another only their own row, and a submit
window that has to be lowered from ISO to millis. A golden that exercises one branch would
match itself and prove nothing.
