// The shape a provider id or model id is allowed to take.
//
// Shared because the same string is checked in three places that must agree: the config
// schema that accepts it, the launch picker that offers it, and the ws query that carries
// it to `claude --model` and ANTHROPIC_MODEL. When those disagree, a config-accepted id is
// dropped at launch — and a dropped *provider* with its model kept would start the session
// on Anthropic instead, which is exactly the silent-wrong-backend this feature exists to
// prevent.
//
// Vendor ids in the wild: `moonshotai/kimi-k2.7-code`, `gpt-5.6-luna-pro`, `z-ai/glm-5.2`,
// `~anthropic/claude-opus-latest`.
export const MODEL_ID_MAX_LENGTH = 120;

// No leading dash (argv would read it as another flag), no whitespace, no control
// characters, and no `|` — the picker joins provider and model with it.
//
// A leading `~` IS allowed: OpenRouter's "always the latest" aliases are named that way
// (`~anthropic/claude-opus-latest`, `~moonshotai/kimi-latest` — 10 of them in the live
// catalog), and unlike `-` it means nothing to an argument parser. Checked against all 342
// catalog ids: none is rejected by this shape.
const MODEL_ID_RE = /^[A-Za-z0-9~][A-Za-z0-9._:/~-]*$/;

export const isUsableModelId = (value: string): boolean => value.length <= MODEL_ID_MAX_LENGTH && MODEL_ID_RE.test(value);
