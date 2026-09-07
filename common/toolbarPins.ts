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

/** How many buttons the toolbar draws, and so how many pins can be promoted at once. The row
 *  already carries the view switch, the grid's own controls, the status tally and two gauges; past
 *  a handful the pins stop being "one press away" and start pushing that row into its horizontal
 *  scroll, which is the two-step this feature exists to remove. */
export const MAX_TOOLBAR_PINS = 5;

/** How many keys the FILE may hold, which is not the same number.
 *
 *  Nothing here ever deletes a key it did not just demote: unpinning a promoted collection leaves
 *  its key in the config, where it draws nothing and takes no slot — and re-pinning brings the
 *  button straight back. That is a deliberate choice over tidying the file on save. Tidying means
 *  deciding "this pin is gone" from a list that might be stale, and one wrong answer deletes a
 *  promotion the user still wants, silently; four separate review findings on PR #1991 were all
 *  ways of getting that decision wrong. A key nobody can see costs a line of JSON.
 *
 *  So the file's own limit is a sanity bound, not a budget — you would have to unpin forty-five
 *  promoted collections to meet it. */
export const MAX_STORED_TOOLBAR_PINS = 50;

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

/** Keep the well-formed keys, in order, deduped, up to the FILE's bound. Anything else — a config
 *  written by hand, a key naming a kind this build does not have — is dropped rather than rendered
 *  as a blank button. The bound here is `MAX_STORED_TOOLBAR_PINS`, not the number of buttons:
 *  truncating to five would delete keys whose pins are merely unpinned right now. */
export function sanitizeToolbarPins(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  input.forEach((raw) => {
    const pin = parseToolbarPin(raw);
    if (!pin) return;
    const key = toolbarPinKey(pin);
    if (out.includes(key) || out.length >= MAX_STORED_TOOLBAR_PINS) return;
    out.push(key);
  });
  return out;
}

/** The pins the toolbar draws: the configured keys, in the CONFIG's order, resolved against the
 *  favourites that exist now, and cut to the number of buttons the row can carry.
 *
 *  A key whose pin is gone — unpinned here, or in MulmoClaude, which writes the same file — is
 *  skipped rather than drawn: the title and icon come from the pin, so there is nothing to label it
 *  with. Skipped, not deleted, and it does not consume one of the five: re-pin it and the button is
 *  back exactly where it was.
 *
 *  What counts as "gone" is gone from the list the CALLER holds. The client store reads
 *  `/api/shortcuts` once per page, so a pin removed by the other app is still drawn until something
 *  re-reads it — which opening Settings' Toolbar pins does (Codex, PR #1991). */
export function resolveToolbarPins(shortcuts: readonly Shortcut[], keys: readonly string[]): Shortcut[] {
  const byKey = new Map(shortcuts.map((shortcut) => [toolbarPinKey(shortcut), shortcut]));
  return keys
    .flatMap((key) => {
      const shortcut = byKey.get(key);
      return shortcut ? [shortcut] : [];
    })
    .slice(0, MAX_TOOLBAR_PINS);
}

/** The list to save after promoting or demoting one pin.
 *
 *  DEMOTING removes exactly the key the user unticked, and nothing else. PROMOTING appends, so a
 *  hand-ordered config is not reshuffled by ticking one more box. Neither ever drops a key that was
 *  not the subject of the click — see `MAX_STORED_TOOLBAR_PINS` for why that restraint is the whole
 *  design rather than an omission.
 *
 *  `live` is what is pinned right now (`toolbarPinKey` of each favourite). It is read ONLY to count
 *  the promotions that can actually be drawn: a key whose pin is gone draws nothing, so counting it
 *  toward the five would fill the row with buttons that are not there and leave nothing to untick
 *  (Codex, PR #1991). Nothing is deleted on the strength of it, which is what makes a stale `live`
 *  harmless here — at worst the count is off by one until the next read.
 *
 *  Returns the SAME array when nothing would change: already promoted, not promoted anyway, or a
 *  promotion refused because the row is full. */
export function nextToolbarPins(keys: readonly string[], live: readonly string[], key: string, promote: boolean): readonly string[] {
  if (!promote) return keys.includes(key) ? keys.filter((entry) => entry !== key) : keys;
  if (keys.includes(key)) return keys;
  const drawn = keys.filter((entry) => live.includes(entry)).length;
  if (drawn >= MAX_TOOLBAR_PINS || keys.length >= MAX_STORED_TOOLBAR_PINS) return keys;
  return [...keys, key];
}
