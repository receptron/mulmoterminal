import { KEYMAP_ACTIONS, type Keymap, type KeymapAction, reservedPlatformsOf, type ReservedPlatform } from "../../common/keymap";

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
  "focus-next": "settings.shortcuts.actions.focusNext",
  "focus-prev": "settings.shortcuts.actions.focusPrev",
  "next-attention": "settings.shortcuts.actions.nextAttention",
  "mark-unread": "settings.shortcuts.actions.markUnread",
  "terminal-new": "settings.shortcuts.actions.terminalNew",
  "terminal-new-here": "settings.shortcuts.actions.terminalNewHere",
  "terminal-new-adjacent": "settings.shortcuts.actions.terminalNewAdjacent",
  "terminal-close": "settings.shortcuts.actions.terminalClose",
  "terminal-restart": "settings.shortcuts.actions.terminalRestart",
  "terminal-move-prev": "settings.shortcuts.actions.terminalMovePrev",
  "terminal-move-next": "settings.shortcuts.actions.terminalMoveNext",
  "terminal-timeline": "settings.shortcuts.actions.terminalTimeline",
  "terminal-talk": "settings.shortcuts.actions.terminalTalk",
  "terminal-park": "settings.shortcuts.actions.terminalPark",
  "terminal-copy-code": "settings.shortcuts.actions.terminalCopyCode",
  "terminal-insert-path": "settings.shortcuts.actions.terminalInsertPath",
  "terminal-reveal": "settings.shortcuts.actions.terminalReveal",
  "terminal-voice": "settings.shortcuts.actions.terminalVoice",
  "terminal-diff": "settings.shortcuts.actions.terminalDiff",
  "terminal-note": "settings.shortcuts.actions.terminalNote",
  "terminal-send-turn": "settings.shortcuts.actions.terminalSendTurn",
  "terminal-send-since": "settings.shortcuts.actions.terminalSendSince",
  "terminal-bring-turn": "settings.shortcuts.actions.terminalBringTurn",
  "terminal-bring-since": "settings.shortcuts.actions.terminalBringSince",
  "pane-files": "settings.shortcuts.actions.paneFiles",
  "pane-prompts": "settings.shortcuts.actions.panePrompts",
  "pane-transcript": "settings.shortcuts.actions.paneTranscript",
  "pane-tools": "settings.shortcuts.actions.paneTools",
  "pane-canvas": "settings.shortcuts.actions.paneCanvas",
  "pane-collections": "settings.shortcuts.actions.paneCollections",
  "files-find": "settings.shortcuts.actions.filesFind",
  "files-search": "settings.shortcuts.actions.filesSearch",
  "files-insert-selection": "settings.shortcuts.actions.filesInsertSelection",
  "files-tab-close": "settings.shortcuts.actions.filesTabClose",
  "files-tab-next": "settings.shortcuts.actions.filesTabNext",
  "files-tab-prev": "settings.shortcuts.actions.filesTabPrev",
  "focus-mode": "settings.shortcuts.actions.focusMode",
  "command-palette": "settings.shortcuts.actions.commandPalette",
  "screen-terminals": "settings.shortcuts.actions.screenTerminals",
  "screen-collections": "settings.shortcuts.actions.screenCollections",
  "screen-feeds": "settings.shortcuts.actions.screenFeeds",
  "screen-accounting": "settings.shortcuts.actions.screenAccounting",
  "screen-files": "settings.shortcuts.actions.screenFiles",
  "screen-wiki": "settings.shortcuts.actions.screenWiki",
  "screen-prs": "settings.shortcuts.actions.screenPrs",
  "screen-rooms": "settings.shortcuts.actions.screenRooms",
  "screen-blueprints": "settings.shortcuts.actions.screenBlueprints",
  "screen-worklog": "settings.shortcuts.actions.screenWorklog",
  "screen-skills": "settings.shortcuts.actions.screenSkills",
  "screen-library": "settings.shortcuts.actions.screenLibrary",
  "screen-processes": "settings.shortcuts.actions.screenProcesses",
  "screen-usage": "settings.shortcuts.actions.screenUsage",
  "screen-toggle": "settings.shortcuts.actions.screenToggle",
  "settings-open": "settings.shortcuts.actions.settingsOpen",
  "sound-toggle": "settings.shortcuts.actions.soundToggle",
  confetti: "settings.shortcuts.actions.confetti",
  "view-toggle": "settings.shortcuts.actions.viewToggle",
  "order-auto": "settings.shortcuts.actions.orderAuto",
  "order-manual": "settings.shortcuts.actions.orderManual",
  "order-priority": "settings.shortcuts.actions.orderPriority",
  "page-next": "settings.shortcuts.actions.pageNext",
  "page-prev": "settings.shortcuts.actions.pagePrev",
  "terminal-reopen": "settings.shortcuts.actions.terminalReopen",
  // Only acts when the terminal has a selection; with none, the key reaches the shell as it
  // always did — which is what makes Ctrl+C a usable binding here without losing interrupt.
  copy: "settings.shortcuts.actions.copy",
  paste: "settings.shortcuts.actions.paste",
};

/** The i18n key naming `action`, for a caller outside the settings list. */
export const keymapLabelKey = (action: KeymapAction): string => LABEL_KEYS[action];

/** The command palette's one-line description of an action, keyed by the label's last segment. */
export const paletteDescriptionKey = (action: KeymapAction): string => `commandPalette.descriptions.${keymapLabelKey(action).split(".").pop() ?? ""}`;

export interface KeymapRow {
  action: KeymapAction;
  /** The i18n key, not the words: this module has no `t`, and the one caller is a component that
   *  does. Resolving here would freeze the label at the locale in force when the row was built. */
  labelKey: string;
  // The user's binding, or null when they haven't set one — shown as "Not set" rather than
  // hidden, since an unbound row is how someone discovers the action exists at all.
  binding: string | null;
  /** The binding names a key this browser keeps for itself, so it never fires here (#2582). */
  reserved: boolean;
}

/** `platform` is the browser's, so a Mac is not told that a working Ctrl+T is dead. */
export const keymapRows = (keymap: Partial<Record<KeymapAction, string>>, platform: ReservedPlatform): KeymapRow[] =>
  KEYMAP_ACTIONS.map((action) => {
    const binding = keymap[action] ?? null;
    return { action, labelKey: LABEL_KEYS[action], binding, reserved: binding !== null && reservedPlatformsOf(binding).includes(platform) };
  });

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
