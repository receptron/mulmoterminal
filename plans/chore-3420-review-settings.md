# Declare this repository's review settings (#3420)

A trial of the dispatcher (#3413) end to end, carried by a small real change.

## Change

Add the `review` key to the committed `.mulmoterminal.json`, keeping the colour keys as they are:

```json
{ "review": { "reviewer": "codex", "maxRounds": 10, "requiredLgtm": 1 } }
```

The values are the documented defaults, written out so the file says what the repository expects
rather than leaning on defaults that could change. Format: `docs/guide/en/config.md#dir-review`.

## Verify

- `reviewSettings { repo: "receptron/mulmoterminal" }` returns those three values.
- `yarn test` passes.
