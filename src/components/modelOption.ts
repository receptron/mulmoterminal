// How a model preset reads in the launch picker (#584), and in what order.
//
// The measurement is the point: every model in the list answers prompts, but only some of
// them drive a tool loop, so an option that showed only a name would be hiding the one
// thing that decides whether the session is usable. The numbers ride in the option text
// because a <select> has nowhere else to put them.
import { MODEL_PRESETS, type ModelPreset } from "../../common/modelPresets";

// Ordering buckets. Within a bucket the built-in order is kept — it runs cheapest-first,
// which is the next thing worth comparing once reliability is equal.
const RELIABLE = 0;
const UNTESTED = 1;
const TROUBLED = 2;

export function modelRank(preset: ModelPreset): number {
  const { trials } = preset;
  if (trials.status === "unmeasured") return UNTESTED;
  if (trials.status === "unreachable") return TROUBLED;
  if (trials.passed === 0) return TROUBLED;
  return trials.passed === trials.of ? RELIABLE : UNTESTED;
}

// A model nobody could reach, or that never once used a tool, stays in the list — the
// question "what about X?" deserves a measurement rather than silence — but it sorts
// below everything that works.
export function sortedModels(models: readonly ModelPreset[]): ModelPreset[] {
  return [...models].sort((a, b) => modelRank(a) - modelRank(b));
}

const CONTEXT_PER_K = 1000;

const contextLabel = (tokens: number): string =>
  tokens >= CONTEXT_PER_K * CONTEXT_PER_K ? `${Math.round(tokens / CONTEXT_PER_K / CONTEXT_PER_K)}M` : `${Math.round(tokens / CONTEXT_PER_K)}k`;

// The part after the name: how it did, then how big a conversation it can hold.
function trialsLabel(preset: ModelPreset): string[] {
  const { trials } = preset;
  if (trials.status === "unreachable") return ["not reachable from this account"];
  if (trials.status === "unmeasured") return ["not tested"];
  if (trials.passed === 0) return [`0/${trials.of} — never used a tool`];
  const rate = `${trials.passed}/${trials.of}`;
  return trials.medianSeconds === null ? [rate] : [rate, `${trials.medianSeconds}s`];
}

export function modelOptionLabel(preset: ModelPreset): string {
  const parts = [...trialsLabel(preset)];
  if (preset.contextLength > 0) parts.push(contextLabel(preset.contextLength));
  return `${preset.label} · ${parts.join(" · ")}`;
}

// The preset a running session's model id belongs to, if we know it. Exact match: these
// ids are what we passed to `claude --model`, and a substring match would let
// `kimi-k2` claim `kimi-k2.7-code`'s context window.
export const presetFor = (model: string): ModelPreset | undefined => MODEL_PRESETS.find((preset) => preset.id.toLowerCase() === model.toLowerCase());
