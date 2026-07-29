// What the model badge says: which model a cell is running, and how full its context is.
// The model id and token count come from the transcript (server /api/session/:id); the agent kind
// is known client-side.
import { presetFor } from "./modelOption";

// Substring → short label for Claude's model families, matched case-insensitively. Anything else
// (a codex model, a future provider) falls back to the id's tail.
const CLAUDE_FAMILIES = [
  { match: "opus", label: "Opus" },
  { match: "sonnet", label: "Sonnet" },
  { match: "haiku", label: "Haiku" },
  { match: "fable", label: "Fable" },
  { match: "mythos", label: "Mythos" },
];

const MILLION_TOKENS = 1_000_000;
const K200_TOKENS = 200_000;
// Context window per model, an ordered substring list (first hit wins) against the lowercased id.
// The current Claude generation ships a 1M window — Opus 4.6+ and 5, Sonnet 4.6+ and 5, Fable,
// Mythos — so those are listed explicitly; older Opus/Sonnet and every Haiku fall through to the
// 200k entries. Add new 1M ids here when they ship, ahead of the bare-family fallbacks, or the
// fallback claims them and the reading comes out 5x too large (#985).
const CONTEXT_WINDOWS: { match: string; tokens: number }[] = [
  { match: "opus-4-6", tokens: MILLION_TOKENS },
  { match: "opus-4-7", tokens: MILLION_TOKENS },
  { match: "opus-4-8", tokens: MILLION_TOKENS },
  { match: "opus-5", tokens: MILLION_TOKENS },
  { match: "sonnet-4-6", tokens: MILLION_TOKENS },
  { match: "sonnet-5", tokens: MILLION_TOKENS },
  { match: "fable", tokens: MILLION_TOKENS },
  { match: "mythos", tokens: MILLION_TOKENS },
  { match: "opus", tokens: K200_TOKENS },
  { match: "sonnet", tokens: K200_TOKENS },
  { match: "haiku", tokens: K200_TOKENS },
];
const PERCENT = 100;

const AGENT_NAME = { claude: "Claude", codex: "Codex", antigravity: "Antigravity" } as const;
export type BadgeAgent = keyof typeof AGENT_NAME;

export function shortModelLabel(model: string): string {
  const preset = presetFor(model);
  if (preset) return preset.label;
  const lower = model.toLowerCase();
  const family = CLAUDE_FAMILIES.find((f) => lower.includes(f.match));
  return family ? family.label : (model.split("/").pop() ?? model);
}

function contextWindowTokens(model: string): number | null {
  // A preset carries the window its provider publishes, so a session on one shows a real % instead
  // of nothing — the substring list only knows Claude's own families.
  const preset = presetFor(model);
  if (preset?.contextLength) return preset.contextLength;
  const lower = model.toLowerCase();
  const entry = CONTEXT_WINDOWS.find((w) => lower.includes(w.match));
  return entry ? entry.tokens : null;
}

type ContextReading = { kind: "measured"; windowTokens: number; percent: number } | { kind: "overflow"; windowTokens: number } | { kind: "no-window" };

// Over 100% is not a measurement: the window is a hard cap, so the only thing an impossible
// percentage tells us is that CONTEXT_WINDOWS has the wrong window for this model. Reported as
// unknown rather than clamped — a precise wrong number gets acted on, and a clamp would hide the
// gap entirely (#985).
function readContext(model: string, contextTokens: number): ContextReading {
  const windowTokens = contextWindowTokens(model);
  if (windowTokens === null) return { kind: "no-window" };
  const percent = Math.round((contextTokens / windowTokens) * PERCENT);
  return percent > PERCENT ? { kind: "overflow", windowTokens } : { kind: "measured", windowTokens, percent };
}

function badgeText(label: string, reading: ContextReading): string {
  if (reading.kind === "measured") return `${label} · ctx ${reading.percent}%`;
  if (reading.kind === "overflow") return `${label} · ctx ?`;
  return label;
}

function badgeTitle(agent: BadgeAgent, model: string, contextTokens: number, reading: ContextReading): string {
  const head = `${AGENT_NAME[agent]} · ${model} · context ${contextTokens.toLocaleString()}`;
  if (reading.kind === "measured") return `${head} / ${reading.windowTokens.toLocaleString()} (${reading.percent}%) tokens`;
  if (reading.kind === "overflow") return `${head} tokens · more than the ${reading.windowTokens.toLocaleString()} window recorded for this model, so no %`;
  return `${head} tokens`;
}

export type ModelBadge = { text: string; title: string };

export function modelBadge(agent: BadgeAgent, model: string, contextTokens: number): ModelBadge {
  const reading = readContext(model, contextTokens);
  return { text: badgeText(shortModelLabel(model), reading), title: badgeTitle(agent, model, contextTokens, reading) };
}
