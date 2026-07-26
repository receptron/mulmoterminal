// How many lines each row of the cockpit roster (the list beside a zoomed terminal) shows before
// it clamps. The roster trades two things against each other: how many sessions fit on screen,
// and how much of each one you can actually read. 2/2/3 is the tight end — it fits a long roster,
// but a summary written as a full sentence is cut mid-thought, which is exactly when you wanted
// to read it. One knob per field, because the three are worth different amounts: a summary says
// what a session is doing NOW, while the prompt is usually short enough at two lines.
//
// Shared across the build boundary: the server sanitizes and serves it, the grid renders from it.

export interface CockpitLines {
  summary: number;
  prompt: number;
  response: number;
}

export const DEFAULT_COCKPIT_LINES: CockpitLines = { summary: 2, prompt: 2, response: 3 };

// 1 is "one line, still clamped"; past ~20 a single row fills the column and the roster stops
// being a roster. Anything outside, or not a whole number, falls back to that field's default.
export const COCKPIT_LINES_MIN = 1;
export const COCKPIT_LINES_MAX = 20;

const oneField = (input: unknown, fallback: number): number => {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback;
  const whole = Math.floor(input);
  if (whole < COCKPIT_LINES_MIN || whole > COCKPIT_LINES_MAX) return fallback;
  return whole;
};

/** Per field, so one bad number can't discard the other two the user set correctly. */
export function sanitizeCockpitLines(input: unknown): CockpitLines {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return DEFAULT_COCKPIT_LINES;
  const o = input as Record<string, unknown>;
  return {
    summary: oneField(o.summary, DEFAULT_COCKPIT_LINES.summary),
    prompt: oneField(o.prompt, DEFAULT_COCKPIT_LINES.prompt),
    response: oneField(o.response, DEFAULT_COCKPIT_LINES.response),
  };
}

/** The inline style that clamps to `lines`. Inline rather than Tailwind's `line-clamp-N`: the
 *  count is a runtime value, and those classes only exist for the literals in the source. */
export const clampStyle = (lines: number): Record<string, string> => ({
  display: "-webkit-box",
  "-webkit-box-orient": "vertical",
  "-webkit-line-clamp": String(lines),
  overflow: "hidden",
});
