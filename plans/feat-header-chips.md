# Phase 4b-2 — configurable cell header chips (toggle / reorder / custom)

Follow-up to #285 / #288. Makes the **grid cell header's** info chips (`TerminalCell.vue` row 1)
user-configurable via the `chips` field that already flows through the header config. Scope is the
**cell header only** — `Terminal.vue`'s own header (single view / zoomed small terminal) is untouched
(user decision).

## Already in place (server + fetch)

- `resolveHeader` returns `chips: ResolvedChip[] | null` — an **ordered** list of
  `{kind:"builtin", id}` | `{kind:"custom", label, text}`, or `null` when unconfigured.
- `chips: null` = unconfigured passthrough. `useHeaderButtons` already fetches `{buttons, chips}` from
  `/api/header`.

The gap: **no client consumes `chips`.** This PR wires `TerminalCell.vue` row 1 to it.

## Cell header row 1 today (the default)

Structural (always, not reorderable): status dot · activity text (`headerText`) · expand/close buttons ·
project badge (`dirConfig.name`). Filmstrip thumbnails drop the info chips entirely.

Reorderable/toggleable **built-in chips**: `dir` · `git` · `diff` · `ctx` · `usage` — each already has its
own data-condition (`headerDir`, `gitStatus`, `showDiffBadge`, `context`, `showUsage`).

`status` and `tools` builtin ids are **not** row-1 reorderable here: `status` is the fixed dot+activity,
`tools` is the row-2 timeline (🕘). They stay structural; documented, not silently dropped.

## Behavior

- **`chips === null` (default): render EXACTLY today.** Hard requirement. The default path uses a fixed
  order `["dir","git","diff","ctx","usage"]`, which reproduces the current markup 1:1 (guarded by the
  existing `TerminalCell.spec` badge assertions + manual check).
- **`chips` configured:** render the built-in chips in the **configured order**, showing only those listed
  (omission = hide); each still respects its data-condition. **Custom chips** render as read-only text
  spans (`label`/`text`, already `${var}`-substituted server-side) in their configured position.

## Implementation

- `TerminalCell.vue`
  - Consume `chips` for this cell's cwd/session/agent (reuse `useHeaderButtons`, ignore `buttons`; the
    inner Terminal keeps fetching its own buttons — same endpoint).
  - A computed `chipOrder`: the configured builtin ids in order, or the default order when `chips===null`.
  - Render row 1's info chips via a `v-for` over `chipOrder` with a switch on chip id → the existing chip
    markup (dir/git/diff/ctx/usage), each keeping its `v-if` data-condition. Custom chips render as a new
    `cell-chip` span.
  - Filmstrip still drops all info chips (unchanged).
- No server change (resolveHeader/chips already exist). No `Terminal.vue` change.

## Default == today

Guarded three ways: the default `chipOrder` reproduces the current order; the info-chip block stays inside
the same `!filmstrip` template; existing `TerminalCell.spec` badge tests must stay green unchanged.

## Tests

- `TerminalCell.spec`: with no chip config, the header still shows dir/git/ctx/usage (unchanged).
- New: a configured `chips` order reorders/hides built-ins; a custom chip renders its substituted text;
  an omitted built-in is hidden.
