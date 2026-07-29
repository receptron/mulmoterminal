import type { SessionAgent } from "./sessionAgent.js";

// A phrase the user sends often, offered as a chip on the phone's terminal view (#830).
// The server validates and stores it; the settings UI edits it — both decide from this
// shape, so it is defined once here rather than mirrored on each side.
//
// `label` is the chip's face and `text` what it inserts, so a short chip can carry a long
// sentence. `agents` scopes it to session kinds; omitted means every kind.
export interface QuickCommand {
  label: string;
  text: string;
  // `| undefined` because quickCommandSchema `satisfies z.ZodType<QuickCommand>`, and
  // Zod's `.optional()` produces `T | undefined`, not "key may be absent".
  agents?: SessionAgent[] | undefined;
}
