# feat #245 — Cost ($) display + daily / monthly roll-up

Child of umbrella #241 ("Terminal + AI 状態管理・可視化・支援レイヤー"). Candidate D.

## Problem

Token counts are already surfaced (session usage badge), but the dollar **cost** —
and today / this-month totals across the project's sessions — are not. Users get
surprised by the monthly bill.

## Design

### Pricing (`server/cost.ts`, new pure module)
- Hardcoded per-model rate table, `$ / 1M tokens` for input / output, from
  Anthropic's public pricing (see the source note in the file). cache-read and
  cache-write are **derived** from the input rate: `0.1×` for cache reads,
  `1.25×` for cache writes (the default 5-minute ephemeral cache that Claude Code
  uses).
- Models keyed by id **prefix** so dated snapshots (`…-20260101`) resolve to their
  family. Unknown model → **unpriced** (rate absent), never guessed.

### Cost calculation (per turn)
- `costForUsage(usage, model)` prices ONE assistant turn using that turn's own
  `message.model` — a session can switch models mid-way, so we never assume one
  rate for the whole file.
- `costFromJsonl(raw) → { usd, unpricedTurns }` sums every assistant turn's
  `message.usage`, counting turns whose model has no known price as `unpricedTurns`
  (excluded from the total).

### Aggregation (`GET /api/cost`, mounted from `cost.ts`)
- `mountCostRoute(app, { resolveCwd })`; one import + one mount in `index.ts`.
- Response: `{ session?, today, month, currency: "USD", unpricedTurns }`.
- `session` (optional `?session=<uuid>`): cost of that session's transcript.
- today / month: **stat-first** scan of `~/.claude/projects/<encoded-cwd>/*.jsonl`,
  bucketed by file **mtime** (local day / month) — the whole file's cost is
  attributed to its mtime day. Files within the month window are sorted newest-first
  and **capped** at `MAX_COST_FILES` (read); a `log()`-style note fires if capped.
- Never throws: missing dir / unreadable file → zeros.

### UI (`src/components/SettingsModal.vue` + `src/composables/useCost.ts`)
- Read-only "Cost (estimated)" block: Session / Today / Month in `$`, with a tooltip
  that these are estimates from public per-model pricing.
- Fetches `/api/cost?cwd=&session=` when the modal opens (via `useCost`, with an
  `AbortController` timeout). Errors are swallowed (block just shows `—`).

## Scope / follow-ups (MVP)
- Covers only the **current project's** sessions. Cross-project roll-up and a live
  per-cell cost badge are follow-ups.
- Flat-plan (Max) users may want to hide `$` — noted in the UI hint; the ON/OFF
  toggle is deliberately **not** built here.
- Cost is bucketed by file mtime (approximation), not by per-turn timestamp.

## File scope
- new: `server/cost.ts`, `server/cost.spec.ts`, `src/composables/useCost.ts`,
  `src/composables/useCost.spec.ts`, this plan.
- edit: `server/index.ts` (1 import + 1 mount), `src/components/SettingsModal.vue`,
  `src/App.vue` (pass `cwd` / `session-id` to the modal).
