// What the PERSON typed at a codex session, as opposed to what codex wrote into their turn.
//
// One rule, three readers: the resume list's title (codex-sessions.ts), the prompt history pane
// (prompt-history.ts) and the handoff's last exchange (last-turn.ts). It lives on its own because
// the rule has changed under all three at once and only one of them was taught (#1962 → #2011):
// a copy per reader is a copy per reader to find next time.
import { isRecord } from "../../common/isRecord.js";

/** Which record carried the turn. Only a reader collecting EVERY prompt needs to know — see
 *  `isDoubleWrite` below. */
export type CodexTurnShape = "event_msg" | "response_item";

export interface CodexUserTurn {
  text: string;
  shape: CodexTurnShape;
}

// A user's turn, in EITHER shape codex has recorded it in. Older rollouts write an `event_msg`
// whose payload type is `user_message`; since 2026-08 the same turn is a `response_item` `message`
// with `role: "user"`. Measured across the 6,334 rollouts on this machine: every one written in
// September 2026 carries only the new record, 1,945 of August's 5,715 already did, and 14 from
// July carry only the old one — so neither shape alone reads the store.
function userTurnTexts(d: Record<string, unknown>): { texts: string[]; shape: CodexTurnShape } | null {
  const { payload } = d;
  if (!isRecord(payload)) return null;
  if (d.type === "event_msg" && payload.type === "user_message") {
    return typeof payload.message === "string" ? { texts: [payload.message], shape: "event_msg" } : null;
  }
  if (d.type !== "response_item" || payload.type !== "message" || payload.role !== "user") return null;
  const { content } = payload;
  if (typeof content === "string") return { texts: [content], shape: "response_item" };
  if (!Array.isArray(content)) return null;
  return { texts: content.flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : [])), shape: "response_item" };
}

// The blocks codex writes INTO a user turn rather than the person writing them. Every leading tag
// in the 6,334 rollouts on this machine is one of these four — environment_context 6,315,
// recommended_plugins 4,521, user_action 14, turn_aborted 8 — and none of them is a prompt.
//
// Named rather than "anything that opens with a tag", because a person's prompt may perfectly well
// open with `<div>` or `<task>`, and treating that as codex's own would drop the one turn it
// speaks for. If codex adds a fifth wrapper the cost is a visibly wrong prompt rather than a
// missing one, and the bundle below still catches it whenever it travels with one of these.
const CODEX_WRAPPER_TAGS: ReadonlySet<string> = new Set(["environment_context", "recommended_plugins", "user_action", "turn_aborted"]);
const LEADING_TAG_RE = /^<([a-zA-Z_][\w.:-]*)[\s>/]/;

// codex bundles its preamble into ONE message with several content parts: the plugin list, the
// repo's AGENTS.md and the environment context together. The person's prompt is the next message.
//
// So the test is per MESSAGE, not per part. The AGENTS.md part carries no tag of its own, and a
// part-level skip would hand every reader that text as the prompt in any repo that has one.
const isSyntheticTurn = (texts: readonly string[]): boolean =>
  texts.some((t) => {
    const tag = LEADING_TAG_RE.exec(t)?.[1];
    return tag !== undefined && CODEX_WRAPPER_TAGS.has(tag);
  });

/** A rollout record's user turn, or null when it is not one — or is codex talking to itself.
 *  Trimmed; the callers cap and clean it for their own surface. */
export function codexUserTurn(d: Record<string, unknown>): CodexUserTurn | null {
  const read = userTurnTexts(d);
  const texts = (read?.texts ?? []).map((t) => t.trim()).filter((t) => t !== "");
  if (read === null || texts.length === 0 || isSyntheticTurn(texts)) return null;
  const text = texts[0];
  return text === undefined ? null : { text, shape: read.shape };
}

/** The same turn's text, for a reader that only wants ONE prompt and so cannot meet the pair
 *  below: the resume list's title and the handoff's last exchange both take the first match. */
export const codexUserPrompt = (d: Record<string, unknown>): string | null => codexUserTurn(d)?.text ?? null;

/** Is this turn the second half of codex writing one prompt TWICE?
 *
 *  For a year codex recorded a prompt as a `response_item` and then, as the VERY NEXT record, an
 *  `event_msg` carrying the identical text — 924 such pairs in the sampled store, every one of them
 *  adjacent and in that order, and not a single case of the two shapes disagreeing. Reading both
 *  shapes is what makes rollouts written since 2026-08 readable at all, so a reader collecting
 *  every prompt has to drop one half or report each prompt twice.
 *
 *  The `event_msg` half is the one dropped, because 28 prompts in the store exist ONLY in that
 *  shape and dropping the other half would lose them. `previous` is the turn from the record
 *  IMMEDIATELY before this one — null for any other record — which is what keeps a person who
 *  really did send the same text twice from being collapsed: their two turns are the same shape
 *  and have a whole reply between them. */
export const isDoubleWrite = (turn: CodexUserTurn, previous: CodexUserTurn | null): boolean =>
  turn.shape === "event_msg" && previous !== null && previous.shape === "response_item" && previous.text === turn.text;
