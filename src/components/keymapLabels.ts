import { KEYMAP_ACTIONS, type Keymap, type KeymapAction } from "../../common/keymap";

// The i18n key naming each bindable action in the settings list.
//
// A full Record, not a key derived as `settings.shortcuts.actions.${action}`: adding an action to
// KEYMAP_ACTIONS then fails to compile until it is named here, so a new shortcut can't ship
// invisible to the one screen that tells the user it exists. A derived key would compile and
// render its own path at runtime instead (#1894).
const LABEL_KEYS: Record<KeymapAction, string> = {
  "zoom-toggle": "settings.shortcuts.actions.zoomToggle",
  "zoom-next": "settings.shortcuts.actions.zoomNext",
  "zoom-prev": "settings.shortcuts.actions.zoomPrev",
  "next-attention": "settings.shortcuts.actions.nextAttention",
  "terminal-new": "settings.shortcuts.actions.terminalNew",
  "terminal-new-here": "settings.shortcuts.actions.terminalNewHere",
  "terminal-new-adjacent": "settings.shortcuts.actions.terminalNewAdjacent",
  "terminal-close": "settings.shortcuts.actions.terminalClose",
  "terminal-restart": "settings.shortcuts.actions.terminalRestart",
  "files-find": "settings.shortcuts.actions.filesFind",
  // Only acts when the terminal has a selection; with none, the key reaches the shell as it
  // always did — which is what makes Ctrl+C a usable binding here without losing interrupt.
  copy: "settings.shortcuts.actions.copy",
  paste: "settings.shortcuts.actions.paste",
};

export interface KeymapRow {
  action: KeymapAction;
  /** The i18n key, not the words: this module has no `t`, and the one caller is a component that
   *  does. Resolving here would freeze the label at the locale in force when the row was built. */
  labelKey: string;
  // The user's binding, or null when they haven't set one — shown as "Not set" rather than
  // hidden, since an unbound row is how someone discovers the action exists at all.
  binding: string | null;
}

export const keymapRows = (keymap: Partial<Record<KeymapAction, string>>): KeymapRow[] =>
  KEYMAP_ACTIONS.map((action) => ({ action, labelKey: LABEL_KEYS[action], binding: keymap[action] ?? null }));

// The `send` bindings, which have no fixed list to render: unlike an action, one exists only
// because the user wrote it, so there is no row to show until they add one.
//
// That is a fact about the ROWS, and it was read as a fact about the feature — so the section
// rendered nothing at all for `send` when the list was empty, and the mechanism was invisible to
// exactly the person looking for it (#1858). The section now names the feature itself in that
// case; this function stays about the entries.
export interface SendRow {
  /** Stable and unique per row, for the list's `v-for` key. The binding string cannot serve:
   *  two entries may claim the same keystroke (validation warns, but the config still loads),
   *  and duplicate keys make Vue reuse DOM nodes across rows — one of the two would vanish from
   *  the very screen that is meant to show what is configured. */
  id: string;
  key: string;
  label: string;
}

// C0 control characters have no glyph, so printing `bytes` raw would render an invisible row —
// the caret spelling (`^E`) is how a terminal has always written them, and is what the user will
// recognise from Ctrl+E. DEL is 0x7f, one past the C0 block, and carries the same notation.
export function describeBytes(bytes: string): string {
  return [...bytes]
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (code === 0x7f) return "^?";
      return code < 0x20 ? `^${String.fromCharCode(code + 0x40)}` : ch;
    })
    .join("");
}

export const sendRows = (keymap: Keymap): SendRow[] =>
  (keymap.send ?? []).map((entry, i) => ({ id: `${i}:${entry.key}`, key: entry.key, label: describeBytes(entry.bytes) }));
