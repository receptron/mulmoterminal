// The header badges for a cursor cell — `⇡20.2k ⇣15` and the context figure — from the ONE place
// cursor states them: its `stop` hook.
//
// EVERY OTHER AGENT HERE IS READ FROM A FILE, and that difference decides the shape of this module.
// codex folds its rollout, grok its `updates.jsonl`, muse its session log, agy a SQLite store — all
// of them re-readable, so their badges are recomputed on each badge poll and survive a restart.
// Cursor writes its counts nowhere: the transcript `.jsonl` carries the conversation and no usage
// at all (measured). They arrive PUSHED, once per turn, and if this process does not add them up
// nothing else will.
//
// So the numbers live in memory, and two consequences follow that a file-backed agent does not have:
// a server restart starts the count again from the next turn, and a cell resumed from before this
// shipped shows nothing until its first turn ends. Both are visible-as-absent rather than wrong,
// which is the trade this file is written to keep — a wrong number here is worse than no number,
// because it is what a user reads before deciding to compact.
//
// The measured `stop` payload (cursor-agent 2026.09.10-fd3934a):
//
//   { "conversation_id": "…", "generation_id": "…", "model": "default", "status": "completed",
//     "loop_count": 0, "input_tokens": 20152, "output_tokens": 15,
//     "cache_read_tokens": 8704, "cache_write_tokens": 0, "transcript_path": "…" }
//
// Two fields in it are traps:
//
//   `model` is **"default"** when the user has not pinned one, which is cursor's word for "Auto"
//   and not a model id. Rendering it would put the literal text `default` in the header where every
//   other cell names its model, so it is dropped — the badge then shows tokens without a model,
//   which is what a cell with an unknown model has always shown.
//
//   `input_tokens` is the whole turn's input, not a delta, so it is the CONTEXT for the next turn
//   (the role codex's `last_token_usage.input_tokens` plays). Whether cursor already counts
//   `cache_read_tokens` inside it is NOT measured, so the cached half is deliberately not added:
//   under-reporting the context bar is recoverable, double-counting it is a number that tells the
//   user to compact when they need not. And it does not only grow — two consecutive turns of one
//   session measured 20152 then 16896, with the cached read going 8704 then 0 — so this is cursor's
//   figure for the turn, not a running context total to be compared across turns.
//
// WHAT THIS DOES NOT BUY YET: the `ctx %` half of the badge. That needs a context WINDOW, which
// cursor states nowhere, and the client's fallback table is keyed by model id — which is
// `"default"` on an Auto session. Pin one (`CURSOR_MODEL`, passed as `--model`) and the payload
// names it, so the percentage appears without another change here.
import { isRecord } from "../../common/isRecord.js";
import type { SessionContextInfo } from "../../common/sessionContext.js";
import type { SessionUsage } from "../session/transcript.js";

export interface CursorBadges {
  usage: SessionUsage;
  context: SessionContextInfo;
}

const EMPTY_USAGE: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

export const EMPTY_CURSOR_BADGES: CursorBadges = { usage: EMPTY_USAGE, context: { model: null, contextTokens: 0, contextWindow: null } };

/** cursor's word for "no model pinned" — an Auto session. Never a model id, never rendered. */
const AUTO_MODEL = "default";

const count = (payload: Record<string, unknown>, key: string): number => {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
};

/** What ONE `stop` payload states. Pure, so the trap fields above are pinned by a spec rather than
 *  trusted. A payload missing every count answers zeroes, which add nothing to the fold. */
export function cursorStopBadges(payload: unknown): CursorBadges {
  if (!isRecord(payload)) return EMPTY_CURSOR_BADGES;
  const model = typeof payload.model === "string" && payload.model !== AUTO_MODEL ? payload.model : null;
  return {
    usage: {
      inputTokens: count(payload, "input_tokens"),
      outputTokens: count(payload, "output_tokens"),
      cacheReadTokens: count(payload, "cache_read_tokens"),
      cacheCreationTokens: count(payload, "cache_write_tokens"),
    },
    context: { model, contextTokens: count(payload, "input_tokens"), contextWindow: null },
  };
}

/** The running totals, plus the LATEST turn's context. Pure, so "which fields accumulate and which
 *  are replaced" is a spec rather than a habit: the ⇡⇣ badge is cumulative, the context bar is the
 *  most recent turn's — the same split codex's fold makes between `total_` and `last_token_usage`.
 *
 *  The model is carried forward: a session that pinned a model and then ran an Auto turn should not
 *  lose the name it had. */
export function foldCursorBadges(previous: CursorBadges, turn: CursorBadges): CursorBadges {
  return {
    usage: {
      inputTokens: previous.usage.inputTokens + turn.usage.inputTokens,
      outputTokens: previous.usage.outputTokens + turn.usage.outputTokens,
      cacheReadTokens: previous.usage.cacheReadTokens + turn.usage.cacheReadTokens,
      cacheCreationTokens: previous.usage.cacheCreationTokens + turn.usage.cacheCreationTokens,
    },
    context: { ...turn.context, model: turn.context.model ?? previous.context.model },
  };
}

// ── the store ─────────────────────────────────────────────────────────────────────────────────
//
// In memory, for the reason in the header: there is no file to re-read. Keyed by the session id
// this server minted, which cursor hands back as `conversation_id` on every hook of that session
// (cursor-args.ts), so no mapping is needed.
//
// BOUNDED BY THE LIVE SESSIONS, and that is the route's job rather than this map's: cursor's hook
// file is machine-global, so a cursor the user started in their own terminal posts `stop` here too,
// and an entry for one would never be reaped — `reap` returns before it, having no pty to end. The
// route therefore records only when the session has one (hook-routes.ts).
const badgesBySession = new Map<string, CursorBadges>();

/** Add one completed turn. Called from the hook route on a cursor `Stop`, and nowhere else. */
export function recordCursorStop(sessionId: string, payload: unknown): void {
  const previous = badgesBySession.get(sessionId) ?? EMPTY_CURSOR_BADGES;
  badgesBySession.set(sessionId, foldCursorBadges(previous, cursorStopBadges(payload)));
}

/** What the badge route answers for a cursor session. A session that has not finished a turn under
 *  this process answers zeroes, and the header renders no badge — the same as a grok session before
 *  its first turn. */
export const cursorBadges = (sessionId: string): CursorBadges => badgesBySession.get(sessionId) ?? EMPTY_CURSOR_BADGES;

/** Dropped when the session ends, beside the other per-session memory (session/lifecycle.ts). */
export function forgetCursorBadges(sessionId: string): void {
  badgesBySession.delete(sessionId);
}
