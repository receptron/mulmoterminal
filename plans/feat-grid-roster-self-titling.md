# feat: grid roster self-titling (freshen stale summaries)

## Problem

The grid cockpit roster shows each session's AI summary (`aiTitle`). That summary
can be **stale** or **externally owned**:

- `aiTitle` on disk (`type: "ai-title"` JSONL records) is written by **MulmoClaude**,
  a different product — this repo only *reads* it (`aiTitleFromJsonl`). For a session
  MulmoTerminal did not launch (an unmanaged Claude Code session, a resumed session,
  or any session after a server restart), MulmoTerminal never regenerates a title, so
  the roster shows whatever frozen external title happens to be on disk.
- Concretely: while viewing this repo's own Claude Code session in the roster, the
  summary was frozen at an old task ("expand時のアニメーション機能追加") even though the
  session had long moved on.

MulmoTerminal *does* generate its own titles for **managed** sessions via the Claude
hook path (`UserPromptSubmit` → `Stop` → `maybeGenerateTitle`, regenerating every
`TITLE_REGEN_EVERY_TURNS` turns). But that path never fires for unmanaged sessions.

## Goal

**The grid roster must always show a MulmoTerminal-generated summary, never the external
on-disk one.** For any session shown in the roster, summarize on *our* side from the
current transcript, and keep it fresh as the session advances.

## Design

### 1. Grid route uses only our own title

`readSessionSummary` (the transcript read behind `GET /api/session/:id`) is consumed
**only** by the grid roster. In that route, drop the external fallback:

```
const aiTitle = aiTitles.get(id) ?? null;   // was: ?? transcriptTitle
```

The session *list* (`readSessionMeta`) keeps its own external-title fallback — this
change is scoped to the grid roster, per the request ("grid view のは確実にこっちで要約").

Until our generation lands, the roster falls back to the prompt / running-program label
(existing behavior) instead of the stale external title.

### 2. View-triggered generation

On each `GET /api/session/:id`, fire-and-forget a freshener that (re)generates our title
from the current transcript when it is stale, then caches it in `aiTitles` (picked up by
the next 4s roster poll). Reuses the existing summarizer (`generateHeaderTitle`, haiku).

Gating (cost control — the roster polls every 4s):
- Skip while a generation for that id is already in flight (`titleInFlight`).
- Regenerate only when stale: never titled this server lifetime, **or** the transcript
  has advanced `VIEW_TITLE_REGEN_TURNS` user turns past the last titling.

### 3. Shared generation core

Extract `generateAndStoreTitle(id, cwd)` — read transcript, summarize, epoch-guard,
store (`aiTitles`, reset `titleTurnCounts`, record `lastTitledUserTurns`), publish.
Both the hook path (`maybeGenerateTitle`) and the view path call it (DRY).

### 4. `/clear` safety (no stale resurrection)

`/clear` drops the title (`forgetTitle` clears `aiTitles`) so the roster stops showing
the pre-clear summary. The view path must not immediately regenerate the *old* summary
from the still-frozen transcript during the post-clear / pre-next-turn window.

Fix: `lastTitledUserTurns` is the staleness baseline and is **kept across `/clear`**
(deleted only on `reap`, i.e. teardown). After `/clear`, `currentUserTurns` has not
advanced past the recorded baseline, so the view path stays quiet until genuinely new
turns are appended — at which point regeneration reads fresh content. The managed hook
path continues to own post-clear titling for managed sessions.

## Pure helpers (unit-tested)

- `header-title.ts`: `VIEW_TITLE_REGEN_TURNS`, and
  `shouldFreshenViewedTitle({ lastTitledUserTurns, currentUserTurns, regenEveryTurns })`
  — mirrors the existing `shouldRegenerateTitle` decision helper.
- `transcript.ts`: `countUserTurnsFromJsonl(raw)` — user-turn count from a transcript.

## Files

- `server/header-title.ts` — new constant + `shouldFreshenViewedTitle`.
- `server/transcript.ts` — `countUserTurnsFromJsonl`.
- `server/index.ts` — `lastTitledUserTurns` map; `generateAndStoreTitle`;
  `freshenRosterTitle`; grid route drops external fallback + calls freshener;
  `readSessionSummary` returns `userTurns`; `reap` clears `lastTitledUserTurns`.
- Tests: `server/header-title.spec.ts`, `server/transcript.spec.ts`.

## Verification

Seed a JSONL transcript with turns whose summary differs from any on-disk `ai-title`,
serve it via an isolated dev server, and confirm the roster shows the MulmoTerminal-
generated summary (not the external one), refreshing as turns are appended.
