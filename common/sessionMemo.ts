// The user's own one-line note on a session, as BOTH sides agree it should look.
//
// Shared because two layers decide from it and must not drift: the input box caps what can be
// typed, and the server caps what it stores. A client-only cap is no cap at all — the route is
// reachable directly — and a server-only one silently truncates what the user was shown typing.

export const MEMO_MAX_LENGTH = 200;

// `Cc` is the C0/C1 control block exactly: the newlines, tabs and terminal escapes a paste can
// carry, and nothing else. `\p{C}` would also take the format category, which is where the
// zero-width joiner holding a multi-part emoji together lives.
const CONTROL_CHARS = /\p{Cc}/gu;

/**
 * A memo as it is stored and shown, or "" for "there is none".
 *
 * "" is the ERASE value, not a memo that happens to be empty: the store deletes on it and the
 * header falls back to the AI title. That is why whitespace-only input normalizes to "" — a
 * user who selects all and types a space means to clear the note.
 */
export function normalizeMemo(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const oneLine = raw.replace(CONTROL_CHARS, " ").replace(/\s+/gu, " ").trim();
  // By code point, so the cap never lands between the halves of a surrogate pair and leaves a
  // lone half in a JSON line that every later reader has to carry.
  return [...oneLine].slice(0, MEMO_MAX_LENGTH).join("");
}

/**
 * The name a session goes by: the user's memo when there is one, else the best generated title
 * on offer, else "" for the caller's own sentinel.
 *
 * Shared because THREE surfaces answer this question — the grid cell's header, the sidebar row
 * and the phone's roster — and a session that goes by two different names depending on where it
 * is looked at is worse than one with no name at all. Each caller passes its own tiers, in its
 * own order; what lives here is the one rule they agree on, that the line the USER wrote outranks
 * everything the agent said.
 *
 * Truthiness, not nullishness: an empty tier means "nothing usable here, keep looking", never
 * "show blank".
 */
export function sessionDisplayName(memo: string | null | undefined, ...generated: (string | null | undefined)[]): string {
  return [memo, ...generated].find((candidate) => !!candidate) ?? "";
}
