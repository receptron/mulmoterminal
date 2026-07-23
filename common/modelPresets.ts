// The models MulmoTerminal offers when launching a session on an Anthropic-compatible
// backend, and how well each one actually drove Claude Code when it was measured.
//
// Shared across the build boundary (like themeIds / dirChrome): the launch picker reads
// it in the browser, and the mulmoterminal-config skill reads it to know what it may
// suggest. One list, one source of truth.
//
// WHY THE NUMBERS: a model that answers a plain prompt can still be unusable, because the
// reply arrives while the tool loop never fires. Measuring that needs a task no model can
// complete by talking — so `scripts/model-trials.ts` makes each one read a file and write
// another, through the real spawn path, and records how many attempts actually produced
// the file. Two models flipped between pass and fail across runs, so this is a ratio, not
// a boolean, and the picker shows it. Re-measure with that script when adding entries.

export interface ModelTrialsMeasured {
  status: "measured";
  // Attempts that completed a tool-using task, out of attempts made.
  passed: number;
  of: number;
  // Typical wall-clock for that task, over the attempts that passed. The spread is wide
  // and worth showing: the same probe ran in 11s on one model and 69s on another. Null
  // when nothing passed — a model can be reachable, answer in prose, and never once call
  // a tool, and that is a different thing from being slow.
  medianSeconds: number | null;
  measuredAt: string;
}

// Could not be reached from the account that ran the measurement — NOT a defect in the
// model. OpenRouter answers 404 "No endpoints available matching your guardrail
// restrictions and data policy" when the account's privacy settings exclude every
// provider serving it. Kept in the list, clearly marked, because another account (or a
// settings change) may run it fine.
export interface ModelTrialsUnreachable {
  status: "unreachable";
  reason: string;
  measuredAt: string;
}

// A model the USER added in their own config. We have no numbers for it — saying so is
// better than implying it was checked.
export interface ModelTrialsUnmeasured {
  status: "unmeasured";
}

export type ModelTrials = ModelTrialsMeasured | ModelTrialsUnreachable | ModelTrialsUnmeasured;

export interface ModelPreset {
  // The `id` of a provider in config.json's `providers`.
  provider: string;
  // Passed to `claude --model`, verbatim.
  id: string;
  label: string;
  contextLength: number;
  // US dollars per million tokens, as published by the provider's catalog. Shown because
  // the range across this list is two orders of magnitude.
  pricePerMTok: { input: number; output: number };
  trials: ModelTrials;
}

const MEASURED_AT = "2026-07-22";

const measured = (passed: number, of: number, medianSeconds: number | null): ModelTrialsMeasured => ({
  status: "measured",
  passed,
  of,
  medianSeconds,
  measuredAt: MEASURED_AT,
});

const unreachable = (reason: string): ModelTrialsUnreachable => ({ status: "unreachable", reason, measuredAt: MEASURED_AT });

const ACCOUNT_PRIVACY = "OpenRouter returned no endpoints for this account's privacy settings — see openrouter.ai/settings/privacy";

export const MODEL_PRESETS: readonly ModelPreset[] = [
  // ── Open models: cheapest first ──────────────────────────────────────────────
  {
    provider: "openrouter",
    id: "nvidia/nemotron-3-super-120b-a12b",
    label: "Nemotron 3 Super 120B",
    contextLength: 1_000_000,
    pricePerMTok: { input: 0.08, output: 0.45 },
    trials: measured(3, 3, 18),
  },
  {
    provider: "openrouter",
    id: "qwen/qwen3-235b-a22b-2507",
    label: "Qwen3 235B A22B",
    contextLength: 262_144,
    pricePerMTok: { input: 0.09, output: 0.55 },
    trials: measured(3, 3, 16),
  },
  {
    provider: "openrouter",
    id: "minimax/minimax-m2.7",
    label: "MiniMax M2.7",
    contextLength: 204_800,
    pricePerMTok: { input: 0.25, output: 1.0 },
    trials: measured(3, 3, 16),
  },
  {
    provider: "openrouter",
    id: "deepseek/deepseek-v3.2",
    label: "DeepSeek V3.2",
    contextLength: 163_840,
    pricePerMTok: { input: 0.269, output: 0.4 },
    trials: measured(3, 3, 42),
  },
  {
    provider: "openrouter",
    id: "minimax/minimax-m3",
    label: "MiniMax M3",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.3, output: 1.2 },
    trials: measured(3, 3, 14),
  },
  {
    provider: "openrouter",
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.435, output: 0.87 },
    trials: measured(3, 3, 20),
  },
  {
    provider: "openrouter",
    id: "deepseek/deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.094, output: 0.188 },
    trials: measured(3, 4, 26),
  },
  {
    provider: "openrouter",
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    contextLength: 131_072,
    pricePerMTok: { input: 0.037, output: 0.17 },
    trials: measured(3, 4, 18),
  },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2-0905",
    label: "Kimi K2 0905",
    contextLength: 262_144,
    pricePerMTok: { input: 0.6, output: 2.5 },
    trials: measured(3, 3, 18),
  },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2-thinking",
    label: "Kimi K2 Thinking",
    contextLength: 262_144,
    pricePerMTok: { input: 0.6, output: 2.5 },
    trials: measured(3, 3, 20),
  },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2.6",
    label: "Kimi K2.6",
    contextLength: 262_144,
    pricePerMTok: { input: 0.684, output: 3.42 },
    trials: measured(3, 3, 46),
  },
  {
    provider: "openrouter",
    id: "z-ai/glm-5.2",
    label: "GLM 5.2",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.819, output: 2.574 },
    trials: measured(3, 3, 21),
  },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k2.7-code",
    label: "Kimi K2.7 Code",
    contextLength: 262_144,
    pricePerMTok: { input: 0.82, output: 3.75 },
    trials: measured(3, 3, 14),
  },
  {
    provider: "openrouter",
    id: "moonshotai/kimi-k3",
    label: "Kimi K3",
    contextLength: 1_048_576,
    pricePerMTok: { input: 3.0, output: 15.0 },
    trials: measured(3, 3, 29),
  },
  {
    provider: "openrouter",
    id: "tencent/hy3",
    label: "Tencent Hy3",
    contextLength: 262_144,
    pricePerMTok: { input: 0.14, output: 0.58 },
    trials: measured(3, 3, 17),
  },
  {
    provider: "openrouter",
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Nemotron 3 Ultra 550B",
    contextLength: 512_288,
    pricePerMTok: { input: 0.6, output: 3.6 },
    trials: measured(3, 3, 13),
  },

  // ── Frontier vendors: cheapest first ─────────────────────────────────────────
  {
    provider: "openrouter",
    id: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.3, output: 2.5 },
    trials: measured(3, 3, 11),
  },
  {
    provider: "openrouter",
    id: "amazon/nova-2-lite-v1",
    label: "Nova 2 Lite",
    contextLength: 1_000_000,
    pricePerMTok: { input: 0.3, output: 2.5 },
    trials: measured(2, 3, 20),
  },
  {
    provider: "openrouter",
    id: "openai/gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    contextLength: 1_050_000,
    pricePerMTok: { input: 1.0, output: 6.0 },
    trials: measured(3, 3, 27),
  },
  {
    provider: "openrouter",
    id: "openai/gpt-5.6-luna-pro",
    label: "GPT-5.6 Luna Pro",
    contextLength: 1_050_000,
    pricePerMTok: { input: 1.0, output: 6.0 },
    trials: measured(3, 3, 69),
  },
  {
    provider: "openrouter",
    id: "google/gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    contextLength: 1_048_576,
    pricePerMTok: { input: 1.5, output: 7.5 },
    trials: measured(3, 3, 16),
  },
  {
    provider: "openrouter",
    id: "x-ai/grok-4.5",
    label: "Grok 4.5",
    contextLength: 500_000,
    pricePerMTok: { input: 2.0, output: 6.0 },
    trials: measured(3, 3, 13),
  },
  {
    provider: "openrouter",
    id: "openai/gpt-5.6-terra-pro",
    label: "GPT-5.6 Terra Pro",
    contextLength: 1_050_000,
    pricePerMTok: { input: 2.5, output: 15.0 },
    trials: measured(3, 3, 38),
  },

  // ── Reached fine, never drove the tool loop ──────────────────────────────────
  // Kept so the list answers "what about X?" with a measurement instead of silence.
  {
    provider: "openrouter",
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    contextLength: 1_048_576,
    pricePerMTok: { input: 0.2, output: 0.8 },
    trials: measured(0, 4, null),
  },

  // ── Not measurable from the machine that built this list ─────────────────────
  {
    provider: "openrouter",
    id: "qwen/qwen3.7-plus",
    label: "Qwen3.7 Plus",
    contextLength: 1_000_000,
    pricePerMTok: { input: 0.32, output: 1.28 },
    trials: unreachable(ACCOUNT_PRIVACY),
  },
  {
    provider: "openrouter",
    id: "mistralai/mistral-medium-3-5",
    label: "Mistral Medium 3.5",
    contextLength: 262_144,
    pricePerMTok: { input: 1.5, output: 7.5 },
    trials: unreachable(ACCOUNT_PRIVACY),
  },
  {
    provider: "openrouter",
    id: "mistralai/devstral-2512",
    label: "Devstral 2512",
    contextLength: 262_144,
    pricePerMTok: { input: 0.4, output: 2.0 },
    trials: unreachable(ACCOUNT_PRIVACY),
  },
];

// Presets for one provider, plus whatever the user added to that provider's `models`.
// A user entry with the same id as a preset keeps the preset's measured numbers rather
// than appearing twice.
export function presetsForProvider(providerId: string, userModels: readonly string[] = []): ModelPreset[] {
  const presets = MODEL_PRESETS.filter((preset) => preset.provider === providerId);
  // Match `presetFor` (modelOption.ts), which compares ids case-insensitively: a user
  // entry that only differs from a preset in case is the same model, not a new one.
  const known = new Set(presets.map((preset) => preset.id.toLowerCase()));
  const added: ModelPreset[] = userModels
    .filter((id) => !known.has(id.toLowerCase()))
    .map((id) => ({ provider: providerId, id, label: id, contextLength: 0, pricePerMTok: { input: 0, output: 0 }, trials: { status: "unmeasured" } }));
  return [...presets, ...added];
}
