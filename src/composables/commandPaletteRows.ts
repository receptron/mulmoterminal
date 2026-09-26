// What the command palette lists (#2266), with no DOM, no i18n instance and no state of its own —
// every input is a parameter, so every rule below is a spec.
import { KEYMAP_ACTIONS, NEEDS_A_CURRENT_TERMINAL, NEEDS_NOTHING_ENLARGED, TERMINAL_SCOPED_ACTIONS, type Keymap, type KeymapAction } from "../../common/keymap";
import { highlightParts, rankPaths, type HighlightPart } from "../components/filePathMatch";

/** The actions a palette can run. Not `copy` / `paste` — they act on a terminal's selection, from
 *  inside it — and not the palette itself. */
export const PALETTE_ACTIONS: readonly KeymapAction[] = KEYMAP_ACTIONS.filter(
  (action) => !TERMINAL_SCOPED_ACTIONS.includes(action) && action !== "command-palette",
);

export interface PaletteRow {
  action: KeymapAction;
  /** The action's name, split into the runs the query matched. */
  label: HighlightPart[];
  description: string;
  /** The user's binding as they wrote it, or null when the action has none. */
  binding: string | null;
  /** Why it cannot run right now, or null when it can. */
  disabledReason: string | null;
}

export interface PaletteText {
  label: (action: KeymapAction) => string;
  description: (action: KeymapAction) => string;
  needsEnlarged: string;
  needsNothingEnlarged: string;
  gridHidden: string;
}

/** The grid's state, as far as the rows care. */
export interface PaletteState {
  zoomed: boolean;
  /** Whether the grid is in front and taking keys; false over another view or the launch panel. */
  available: boolean;
}

const disabledReason = (action: KeymapAction, { zoomed, available }: PaletteState, text: PaletteText): string | null => {
  if (!available) return text.gridHidden;
  if (NEEDS_A_CURRENT_TERMINAL.includes(action) && !zoomed) return text.needsEnlarged;
  if (NEEDS_NOTHING_ENLARGED.includes(action) && zoomed) return text.needsNothingEnlarged;
  return null;
};

/** The rows for this query, best first. The action id is searched as well as the name, so typing
 *  the name the config uses (`files-find`) finds it too; only the name is highlighted. */
export function paletteRows(query: string, keymap: Keymap, state: PaletteState, text: PaletteText): PaletteRow[] {
  const byCandidate = new Map<string, KeymapAction>(PALETTE_ACTIONS.map((action) => [`${text.label(action)} ${action}`, action]));
  return rankPaths([...byCandidate.keys()], query, PALETTE_ACTIONS.length).flatMap((match) => {
    const action = byCandidate.get(match.path);
    if (action === undefined) return [];
    const name = text.label(action);
    return [
      {
        action,
        label: highlightParts(
          name,
          match.indexes.filter((index) => index < name.length),
        ),
        description: text.description(action),
        binding: keymap[action] ?? null,
        disabledReason: disabledReason(action, state, text),
      },
    ];
  });
}
