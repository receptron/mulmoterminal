# feat #246 — Command output AI summary / Explain (Run cell)

Parent umbrella: #241 (Terminal + AI state/visualisation/assist layer). This is
child **E**.

## Problem

`npm install` / `cargo build` / `docker logs` produce thousands of lines. The user
usually only wants the **failure reason or the warnings**, plus a likely cause and a
fix — but those are buried, and the log must be read by hand.

## Scope (MVP)

A **manual** "Summarize / Explain" action on a **command cell** (the `/ws/run`
script cells — NOT Claude sessions). Clicking it sends the cell's captured terminal
output to a new server endpoint that runs `claude -p` (headless, non-interactive) and
returns a short structured summary (Errors / Warnings / likely cause / suggested fix).
The result renders in a small panel inside the cell.

## Design decisions

- **Trigger — manual button.** The ✦ Summarize button lives in the command cell
  header and is shown at all times (a manual action; the user decides when the output
  is worth explaining). It never auto-runs. Empty output is handled gracefully
  server-side.
- **Capture — client sends the xterm buffer.** The xterm buffer already lives on the
  client, so the cell reads it (via a new `readOutput()` exposed from `Terminal.vue`
  → `useTerminalConnections.readBuffer`) and POSTs the text. No new server-side
  capture path is needed.
- **Truncation — last 32 KB.** Capped client-side (cheap) AND server-side (defence in
  depth) via a pure `truncateLog(log, maxKb)` that keeps the **tail** (errors/exit live
  there) and drops a leading partial line.
- **Endpoint — `POST /api/command/summarize`** in a new module
  `server/command-summary.ts` exposing `mountCommandSummaryRoute(app, { isAllowedOrigin })`
  (mirrors `mountPickFileRoute`: same-origin guarded like the other local-action
  routes). It spawns `claude -p "<prompt>"` via `node:child_process` (argv, no shell),
  feeding the truncated log on **stdin** (`cat log | claude -p "explain"`), and returns
  `{ summary, truncated }`.
- **Spawn isolated for testing.** The child spawn is a small `runClaudeHeadless`
  helper injected into `summarizeLog(log, { runClaude })` so tests mock it — no CLI /
  API key needed. Pure helpers `truncateLog`, `buildSummaryPrompt`, `parseSummaryOutput`
  are unit-tested directly.
- **Prompt.** Asks claude to report only Errors / Warnings / Likely cause / Suggested
  fix, concisely (< ~120 words), and to omit sections that don't apply.

## Files

- `server/command-summary.ts` (new) — route + pure helpers + spawn helper.
- `server/command-summary.spec.ts` (new) — truncation boundary, prompt, parse, happy
  path, empty output, spawn failure.
- `server/index.ts` — one import + one `mountCommandSummaryRoute(app, { isAllowedOrigin })`.
- `src/composables/useTerminalConnections.ts` — `readBuffer(key)` reads the xterm buffer.
- `src/components/Terminal.vue` — expose `readOutput()`.
- `src/components/CommandCell.vue` — Summarize button + result panel + fetch.
- `src/components/CommandCell.spec.ts` — button/panel/fetch behaviour (mocked).
- `README.md` — document the endpoint + the cell action.

## Non-scope (deferred)

- Auto-run on `exit != 0` (#246 option 2) — kept manual for the MVP.
- `error|warn` grep pre-extraction to compress the payload (#246 option 3) — plain
  tail-truncation for now.
- Counting the summary's own token spend into the #245 (#D) cost roll-up.
- Structured JSON sections in the response — returns a single `summary` string.
- Summarizing Claude sessions (only `/ws/run` command cells are in scope).
