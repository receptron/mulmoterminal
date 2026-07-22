// The two payload shapes a cell believes without asking anyone: the token usage and the
// running model/context that back its header badges.
//
// They arrive from /api/session/:id and the cost route, and the guards only asked whether a
// key was PRESENT. `{ outputTokens: null }` — a field the server could not compute, or a
// version skew — passed, and the badge rendered NaN. A guard that admits a shape it cannot
// render is not doing the job the guard exists for (#611).
//
// Pure and separate so the shapes can be checked against what a server actually sends,
// rather than only through a mounted cell.

export interface CellUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface CellContext {
  model: string | null;
  contextTokens: number;
}

// Rendered as a number, so it has to be one: NaN and Infinity read as a broken badge just as
// a string would.
const isRenderableCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null);

export function isCellUsage(value: unknown): value is CellUsage {
  const usage = asRecord(value);
  if (!usage) return false;
  // Every field is shown, so a missing one is a badge with a hole in it — not a partial
  // update worth taking.
  return (
    isRenderableCount(usage.inputTokens) &&
    isRenderableCount(usage.outputTokens) &&
    isRenderableCount(usage.cacheReadTokens) &&
    isRenderableCount(usage.cacheCreationTokens)
  );
}

export function isCellContext(value: unknown): value is CellContext {
  const context = asRecord(value);
  if (!context) return false;
  // `model` is legitimately null before the first assistant turn — that hides the badge,
  // which is different from the field being the wrong type.
  const modelOk = context.model === null || typeof context.model === "string";
  return modelOk && isRenderableCount(context.contextTokens);
}
