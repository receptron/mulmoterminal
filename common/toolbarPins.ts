// Which of the pinned favourites the app toolbar shows without opening Collections (#1984).
//
// Shared because both sides decide from it: the server sanitizes what `~/.mulmoterminal/config.json`
// says, the browser renders the toolbar and writes the same field back.
//
// Deliberately NOT a field on `Shortcut`. The pins themselves live in `<workspace>/config/shortcuts.json`,
// which MulmoTerminal SHARES with MulmoClaude, and both apps rebuild every record when they write it
// (`normalizeShortcuts`) — so a field one app added is dropped the first time the other pins anything.
// This is a MulmoTerminal-side view preference over that shared list, and it holds only the identity
// of the pins it promotes: the label and the icon are read from the pin, so renaming a collection
// cannot leave the toolbar saying the old name.
import { SHORTCUT_KINDS, type Shortcut, type ShortcutKind } from "./shortcuts.js";

/** The toolbar is the row that already carries the view switch, the grid's own controls, the status
 *  tally and two gauges. Past a handful the pins stop being "one press away" and start pushing that
 *  row into its horizontal scroll, which is the two-step this feature exists to remove. */
export const MAX_TOOLBAR_PINS = 5;

/** How one promoted pin is named in the config: `"collection:works"`. */
export const toolbarPinKey = (pin: Pick<Shortcut, "kind" | "slug">): string => `${pin.kind}:${pin.slug}`;

// Split on the FIRST colon, not every colon: `kind` is one of two known words, so everything after
// it is the slug even if a slug ever contains one.
function parseToolbarPin(key: unknown): { kind: ShortcutKind; slug: string } | null {
  if (typeof key !== "string") return null;
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const kind = SHORTCUT_KINDS.find((candidate) => candidate === key.slice(0, separator));
  if (kind === undefined) return null;
  const slug = key.slice(separator + 1);
  return slug.length > 0 ? { kind, slug } : null;
}

/** Keep the well-formed keys, in order, deduped, up to the cap. Anything else — a config written by
 *  hand, a key naming a kind this build does not have — is dropped rather than rendered as a blank
 *  button. */
export function sanitizeToolbarPins(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  input.forEach((raw) => {
    const pin = parseToolbarPin(raw);
    if (!pin) return;
    const key = toolbarPinKey(pin);
    if (out.includes(key) || out.length >= MAX_TOOLBAR_PINS) return;
    out.push(key);
  });
  return out;
}

/** The pins the toolbar draws: the configured keys, in the CONFIG's order, resolved against the
 *  favourites that actually exist now.
 *
 *  A key whose pin is gone — unpinned here, or in MulmoClaude, which writes the same file — is
 *  dropped rather than drawn: the title and icon come from the pin, so there is nothing to label
 *  it with. Drawing is all this decides: the key itself survives in the config until the next save
 *  clears it (`nextToolbarPins`), so re-pinning before then brings the button back.
 *
 *  "Gone" means gone from the list the CALLER holds. The client store reads `/api/shortcuts` once
 *  per page, so a pin removed by the other app is still drawn until something re-reads it — which
 *  opening Settings' Toolbar pins does (Codex, PR #1991). */
export function resolveToolbarPins(shortcuts: readonly Shortcut[], keys: readonly string[]): Shortcut[] {
  const byKey = new Map(shortcuts.map((shortcut) => [toolbarPinKey(shortcut), shortcut]));
  return keys.flatMap((key) => {
    const shortcut = byKey.get(key);
    return shortcut ? [shortcut] : [];
  });
}

/** The list to save after promoting or demoting one pin.
 *
 *  `live` is what is pinned RIGHT NOW (`toolbarPinKey` of each favourite). Keys outside it are
 *  dropped from the result, which is what keeps a key whose pin was removed — here or in
 *  MulmoClaude — from occupying a slot the toolbar cannot draw. That matters because such a key is
 *  invisible: it is not in the list Settings offers, so five of them would fill the cap with
 *  nothing on screen to untick (Codex, PR #1991). The pruning rides on a save the user asked for
 *  rather than happening on load, so a routine visit never rewrites the config.
 *
 *  An EMPTY `live` prunes nothing: "no favourites exist" and "the favourites have not loaded" look
 *  identical from here, and the second must not be written back as a deletion — the rule
 *  `reconcileShortcuts` states for the shared file, applied to this one.
 *
 *  Existing entries keep their positions and a newly promoted one goes to the END, so a user who
 *  hand-ordered the config does not have it reshuffled by ticking one more box. Returns the SAME
 *  array when nothing would change — including a promotion refused because the cap is full. */
export function nextToolbarPins(keys: readonly string[], live: readonly string[], key: string, promote: boolean): readonly string[] {
  const kept = live.length ? keys.filter((entry) => live.includes(entry)) : [...keys];
  const held = kept.includes(key);
  const promoted = held || kept.length >= MAX_TOOLBAR_PINS ? kept : [...kept, key];
  const next = promote ? promoted : kept.filter((entry) => entry !== key);
  return sameKeys(next, keys) ? keys : next;
}

/** Same keys in the same order — what "nothing to save" means for a list whose ORDER is what it
 *  says. Answered by value rather than by reference so the caller can skip the write. */
const sameKeys = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);
