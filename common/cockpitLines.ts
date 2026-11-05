// How many lines each row of the cockpit roster (the list beside a zoomed terminal) shows before
// it clamps. The roster trades two things against each other: how many sessions fit on screen,
// and how much of each one you can read without opening it. 2/2/3 is the tight end — it fits a
// long roster, but a summary written as a full sentence gets cut mid-thought, which is exactly
// when you wanted to read it. That is a trade the user should get to make, not a bug to fix, so
// the defaults stay put and the knob is opt-in.
//
// One knob per field: the three are worth different amounts. A summary says what a session is
// doing NOW, while a prompt is usually done in two lines.
//
// Shared because both sides decide from it: the server sanitizes and serves it, the grid renders
// from it. The CSS that applies the clamp is NOT here — the server has no use for it (#877).

import { isRecord } from "./isRecord.js";

export interface CockpitLines {
  summary: number;
  prompt: number;
  response: number;
}

export const DEFAULT_COCKPIT_LINES: CockpitLines = { summary: 2, prompt: 2, response: 3 };

// 1 is "one line, still clamped". Past ~20 a single row fills the column and the roster stops
// being a roster.
export const COCKPIT_LINES_MIN = 1;
export const COCKPIT_LINES_MAX = 20;

// Clamp an out-of-range number and round a fractional one — the contract normalizeFontSize
// states for the font size, for the same reason: on a bounded number the user asked for a
// DIRECTION, so honouring it reads as working where falling back to the default reads as
// ignored. Non-numeric is a different thing — "nothing configured here" — and falls back.
const oneField = (input: unknown, fallback: number): number => {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback;
  return Math.min(COCKPIT_LINES_MAX, Math.max(COCKPIT_LINES_MIN, Math.round(input)));
};

/** Per field, so one typo can't discard the two the user set correctly. */
export function sanitizeCockpitLines(input: unknown): CockpitLines {
  if (!isRecord(input)) return { ...DEFAULT_COCKPIT_LINES };
  return {
    summary: oneField(input.summary, DEFAULT_COCKPIT_LINES.summary),
    prompt: oneField(input.prompt, DEFAULT_COCKPIT_LINES.prompt),
    response: oneField(input.response, DEFAULT_COCKPIT_LINES.response),
  };
}
