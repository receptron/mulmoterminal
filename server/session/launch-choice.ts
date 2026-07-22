// What the browser picked in the launch form (#584), turned into a provider/model choice.
//
// These two values reach `claude --model` as argv and ANTHROPIC_MODEL in the child's
// environment, so they are validated here rather than trusted: a model id is an opaque
// vendor string, but it is never blank, never long, and never carries whitespace, control
// characters, or a leading dash that argv would read as another flag.
import type { DirModelChoice } from "./provider-env.js";

const MAX_ID_LENGTH = 120;

// Vendor ids in the wild: `moonshotai/kimi-k2.7-code`, `gpt-5.6-luna-pro`, `z-ai/glm-5.2`.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

const isUsableId = (value: string): boolean => value.length <= MAX_ID_LENGTH && ID_RE.test(value);

const cleanParam = (params: URLSearchParams, name: string): string | null => {
  const value = params.get(name);
  if (value === null) return null;
  const trimmed = value.trim();
  if (!isUsableId(trimmed)) {
    console.warn(`[ws] ignoring unusable ${name} in launch params: ${JSON.stringify(value)}`);
    return null;
  }
  return trimmed;
};

// Undefined — the usual case — means "whatever this directory's .mulmoterminal.json says".
// Returning a partial choice is intentional: a bare `model` is a valid pick on the default
// Anthropic backend, and a `provider` with no model is refused later by resolveProvider
// with a message that names what is missing.
export function launchChoiceFromParams(params: URLSearchParams): DirModelChoice | undefined {
  const provider = cleanParam(params, "provider");
  const model = cleanParam(params, "model");
  if (!provider && !model) return undefined;
  return { provider, model };
}

// What a session actually runs on: the launch form's pick when there was one, otherwise
// the directory's default. Whole-pair, never field-by-field — mixing a provider from the
// picker with a model from .mulmoterminal.json produces a combination neither of them
// asked for, and the pairing is the part that has to be right.
export function effectiveChoice(launch: DirModelChoice | undefined, dir: DirModelChoice): DirModelChoice {
  return launch ?? dir;
}
