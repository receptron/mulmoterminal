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
 *  it with. The key stays in the config, so re-pinning it brings the button back. */
export function resolveToolbarPins(shortcuts: readonly Shortcut[], keys: readonly string[]): Shortcut[] {
  const byKey = new Map(shortcuts.map((shortcut) => [toolbarPinKey(shortcut), shortcut]));
  return keys.flatMap((key) => {
    const shortcut = byKey.get(key);
    return shortcut ? [shortcut] : [];
  });
}

/** Promote or demote one pin, returning the list to save.
 *
 *  Existing entries keep their positions and a newly promoted one goes to the END, so a user who
 *  hand-ordered the config does not have it reshuffled by ticking one more box. Returns the SAME
 *  array when nothing would change — including a promotion refused because the cap is full, which
 *  is what the UI disables the box for. */
export function toggleToolbarPin(keys: readonly string[], key: string, promote: boolean): readonly string[] {
  const held = keys.includes(key);
  if (!promote) return held ? keys.filter((entry) => entry !== key) : keys;
  if (held || keys.length >= MAX_TOOLBAR_PINS) return keys;
  return [...keys, key];
}
