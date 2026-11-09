// Which credential a new session runs on, when several subscriptions share one home (#2919).
//
// The goal is the user's: drain every weekly window as evenly as possible. Ranking by remaining %
// alone would sit on a window that resets tomorrow with half of it unused while spending one that
// has six days left, so the rule ranks by BURN PACE — what is left per hour until it resets. The
// window about to reset with room in it goes first, because that room is lost at the reset.
//
// Pure: the caller supplies the readings and the clock.
import type { RateLimits, RateLimitWindow } from "../../../common/rateLimits.js";

export interface TokenCandidate {
  id: string;
  /** The last reading for this credential, however old; null when it was never measured. */
  limits: RateLimits | null;
  /** Until when a limit hit observed on a session holds it out, in Unix seconds. */
  spentUntil_sec?: number | null;
  /** How many sessions are running on it right now (#2926). */
  liveSessions?: number;
  /** Percent of the 7-day window never to spend on it (#3064). */
  reserveWeeklyPercent?: number | undefined;
  /** The latest probe got no answer, so `limits` is a reading nothing has confirmed since (#3291). */
  probeFailed?: boolean;
}

/** At or above this, a 5-hour window is too close to blocking a turn to start a session on it. */
export const FIVE_HOUR_CEILING_PERCENT = 90;
/** The user's line (#2919): a week this full is treated as spent, both for choosing a new session's
 *  credential and for moving a running one at the end of its turn. */
export const SWITCH_AT_PERCENT = 98;
export const SEVEN_DAY_CEILING_PERCENT = SWITCH_AT_PERCENT;
/** A window resetting within this many hours is ranked as if it had this long left, so a reading
 *  a minute before its reset does not dwarf every other candidate. */
export const MIN_HOURS_TO_RESET = 1;
const SECONDS_PER_HOUR = 3600;
const FULL_PERCENT = 100;
const HOURS_PER_WEEK = 7 * 24;

/** A window whose reset has already passed holds nothing back. */
const usedNow = (window: RateLimitWindow | null, now_sec: number): number => {
  if (!window) return 0;
  return window.resetsAt_sec !== null && window.resetsAt_sec <= now_sec ? 0 : window.usedPercentage;
};

/** Where a 7-day window counts as spent: the switch line, or lower when part of the week is reserved. */
export const sevenDayCeiling = (reserveWeeklyPercent = 0): number => Math.min(SEVEN_DAY_CEILING_PERCENT, FULL_PERCENT - reserveWeeklyPercent);

/** Whether the candidate's week is down to its reserve — the one hold-out the fallback must respect. */
const reserveReached = (candidate: TokenCandidate, now_sec: number): boolean =>
  !!candidate.reserveWeeklyPercent && !!candidate.limits && usedNow(candidate.limits.sevenDay, now_sec) >= sevenDayCeiling(candidate.reserveWeeklyPercent);

/** When this candidate can take a session again, or null when it can now. */
export function blockedUntil(candidate: TokenCandidate, now_sec: number): number | null {
  const blocks: number[] = [];
  if (candidate.spentUntil_sec && candidate.spentUntil_sec > now_sec) blocks.push(candidate.spentUntil_sec);
  const limits = candidate.limits;
  const reset = (window: RateLimitWindow | null): number => window?.resetsAt_sec ?? Number.POSITIVE_INFINITY;
  if (limits && usedNow(limits.sevenDay, now_sec) >= sevenDayCeiling(candidate.reserveWeeklyPercent)) blocks.push(reset(limits.sevenDay));
  if (limits && usedNow(limits.fiveHour, now_sec) >= FIVE_HOUR_CEILING_PERCENT) blocks.push(reset(limits.fiveHour));
  return blocks.length > 0 ? Math.max(...blocks) : null;
}

/** Whether a running session on these readings should move at the end of its turn: either window is
 *  at the switch line, the week at its reserve's. Null readings never move anything — there is nothing to say it is full. */
export function nearLimit(limits: RateLimits | null, now_sec: number, reserveWeeklyPercent = 0): boolean {
  if (!limits) return false;
  return usedNow(limits.fiveHour, now_sec) >= SWITCH_AT_PERCENT || usedNow(limits.sevenDay, now_sec) >= sevenDayCeiling(reserveWeeklyPercent);
}

/** Remaining weekly percent above the reserve per hour to its reset — higher is more urgent to use. A
 *  reading with no 7-day window, or no reset time, is ranked by what remains over a full week. */
export function burnPace(limits: RateLimits, now_sec: number, reserveWeeklyPercent = 0): number {
  const window = limits.sevenDay;
  const remaining = Math.max(0, FULL_PERCENT - reserveWeeklyPercent - usedNow(window, now_sec));
  const resetsAt = window?.resetsAt_sec;
  const hours = resetsAt && resetsAt > now_sec ? (resetsAt - now_sec) / SECONDS_PER_HOUR : HOURS_PER_WEEK;
  return remaining / Math.max(hours, MIN_HOURS_TO_RESET);
}

const RANK_MEASURED = 0;
const RANK_UNMEASURED = 1;

/**
 * The candidate a new session should run on, or null when there are none.
 *
 * Eligible and measured first, by burn pace shared among the sessions already running there; then
 * eligible but never measured (the next probe measures it), or measured only before a probe that
 * failed — a stale reading of an unused week would otherwise win every time (#3291); and only when every one is held out, the
 * one free soonest — never one down to its reserve, which would spend the very room it keeps. Ties go to fewer running sessions, then config order.
 *
 * The sharing is what spreads parallel sessions (#2926): by pace alone every one of them landed on
 * the same subscription until its 5-hour window filled, because the readings only move when a probe
 * runs — while the count of sessions moves the moment one is assigned.
 */
export function chooseToken(candidates: readonly TokenCandidate[], now_sec: number): string | null {
  if (candidates.length === 0) return null;
  const free = candidates.filter((candidate) => blockedUntil(candidate, now_sec) === null);
  if (free.length === 0) {
    const freeAt = (candidate: TokenCandidate): number => blockedUntil(candidate, now_sec) ?? now_sec;
    const spendable = candidates.filter((candidate) => !reserveReached(candidate, now_sec));
    return spendable.length === 0 ? null : spendable.reduce((best, candidate) => (freeAt(candidate) < freeAt(best) ? candidate : best)).id;
  }
  const ranked = free.map((candidate, order) => {
    const load = candidate.liveSessions ?? 0;
    const confirmed = candidate.probeFailed ? null : candidate.limits;
    const pace = confirmed ? burnPace(confirmed, now_sec, candidate.reserveWeeklyPercent) : 0;
    return { id: candidate.id, order, load, rank: confirmed ? RANK_MEASURED : RANK_UNMEASURED, share: pace / (1 + load) };
  });
  ranked.sort((a, b) => a.rank - b.rank || b.share - a.share || a.load - b.load || a.order - b.order);
  return ranked[0]?.id ?? null;
}
