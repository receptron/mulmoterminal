// What the browser picked in the launch form (#584), turned into a provider/model choice.
//
// These two values reach `claude --model` as argv and ANTHROPIC_MODEL in the child's
// environment, so they are validated here rather than trusted — against the same id shape
// the config schema accepts, so the picker can never offer something this drops.
//
// The parsing is ALL-OR-NOTHING on purpose. Keeping the usable half of a bad pair is the
// one outcome that must not happen: a rejected `provider` whose `model` survives resolves
// to Anthropic running another vendor's model id, which is the silent wrong-backend this
// whole feature exists to prevent. A wholly-dropped choice falls back to the directory's
// own default — at least a pair its owner chose.
import { isUsableModelId } from "../../common/modelIds.js";
import type { DirModelChoice } from "./provider-env.js";

type CleanParam = { ok: true; value: string | null } | { ok: false };

const cleanParam = (params: URLSearchParams, name: string): CleanParam => {
  const raw = params.get(name);
  if (raw === null) return { ok: true, value: null };
  const value = raw.trim();
  if (!isUsableModelId(value)) {
    console.warn(`[ws] ignoring launch params: unusable ${name} ${JSON.stringify(raw)}`);
    return { ok: false };
  }
  return { ok: true, value };
};

// Undefined — the usual case — means "whatever this directory's .mulmoterminal.json says".
// A provider with no model still travels: resolveProvider refuses it with a message naming
// what is missing, which is more use to the reader than quietly ignoring their pick.
export function launchChoiceFromParams(params: URLSearchParams): DirModelChoice | undefined {
  const provider = cleanParam(params, "provider");
  const model = cleanParam(params, "model");
  if (!provider.ok || !model.ok) return undefined;
  if (!provider.value && !model.value) return undefined;
  return { provider: provider.value, model: model.value };
}

export interface ChoiceInputs {
  // What the browser picked for the session it is starting now.
  launch?: DirModelChoice;
  // What THIS session id was started on, when this server is the one that started it.
  remembered?: DirModelChoice;
  // The directory's own default.
  dir: DirModelChoice;
  // Continuing an existing conversation rather than beginning one.
  resuming: boolean;
}

// What a session actually runs on.
//
// Whole-pair, never field-by-field: mixing a provider from one source with a model from
// another produces a combination neither asked for, and the pairing is the part that has
// to be right.
//
// A resume ignores the picker entirely. The browser re-sends whatever its cell still holds
// on every reconnect, and that value belongs to the session that cell launched — not
// necessarily to the one being resumed. What the session was actually started on is the
// only defensible answer; the directory's default is the fallback when this server never
// saw it start.
//
// Only the PICKER'S choice is remembered, and the asymmetry is deliberate. That choice has
// nowhere else to live, so losing it drops the session onto a backend its user never chose
// for it. The directory's default IS that backend — and like every other field in
// .mulmoterminal.json (theme, colours, the skill list) it is read fresh on each spawn, so
// editing the file takes effect. Making these two keys uniquely sticky would also read
// differently either side of a server restart, since this memory is in-process.
export function effectiveChoice({ launch, remembered, dir, resuming }: ChoiceInputs): DirModelChoice {
  if (resuming) return remembered ?? dir;
  return launch ?? dir;
}
