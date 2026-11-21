// The actions that act on ONE terminal, by the same names everywhere: a `run: "action"` header
// button, a `keymap` binding, and the command palette (which lists every keymap action). One list
// so an operation cannot be reachable from one of the three and missing from another.
import type { KeymapAction } from "./keymap.js";
import { APP_ACTIONS, isAppAction, type AppAction } from "./appActions.js";

// The panes a cell's History / Tools / path menus open, each also a RightPane (TerminalGrid pins
// that by type).
export const PANE_ACTIONS = ["pane-files", "pane-prompts", "pane-transcript", "pane-tools", "pane-canvas", "pane-collections"] as const;

// What the cell itself does, with no help from the grid: TerminalCell registers a handler for these.
export const CELL_SELF_ACTIONS = [
  "terminal-restart",
  "terminal-timeline",
  "terminal-talk",
  "terminal-park",
  "terminal-copy-code",
  "terminal-insert-path",
  "terminal-reveal",
  "terminal-voice",
  "terminal-diff",
  "terminal-note",
  "terminal-send-turn",
  "terminal-send-since",
  "terminal-bring-turn",
  "terminal-bring-since",
] as const;

export const CELL_ACTIONS = [
  "zoom-toggle",
  "mark-unread",
  "terminal-new-here",
  "terminal-new-adjacent",
  "terminal-close",
  "terminal-move-prev",
  "terminal-move-next",
  ...CELL_SELF_ACTIONS,
  ...PANE_ACTIONS,
] as const satisfies readonly KeymapAction[];

// A header button written before the names were shared. `restart` shipped as a header action, so a
// config holding it must keep working; the loader rewrites it to the current name.
export const LEGACY_HEADER_ACTIONS = { restart: "terminal-restart" } as const satisfies Record<string, CellAction>;

// What a config may write: the cell's actions, the app's (the toolbar's operations, which act on
// no cell), and the old name.
export const HEADER_ACTIONS = [...CELL_ACTIONS, ...APP_ACTIONS, "restart"] as const;

export type PaneAction = (typeof PANE_ACTIONS)[number];
export type CellSelfAction = (typeof CELL_SELF_ACTIONS)[number];
export type CellAction = (typeof CELL_ACTIONS)[number];

export const isCellAction = (value: unknown): value is CellAction => CELL_ACTIONS.some((action) => action === value);
export const isPaneAction = (value: CellAction): value is PaneAction => PANE_ACTIONS.some((pane) => pane === value);
export const isCellSelfAction = (value: CellAction): value is CellSelfAction => CELL_SELF_ACTIONS.some((action) => action === value);

const PANE_OF = {
  "pane-files": "files",
  "pane-prompts": "prompts",
  "pane-transcript": "transcript",
  "pane-tools": "tools",
  "pane-canvas": "canvas",
  "pane-collections": "collections",
} as const satisfies Record<PaneAction, string>;

/** The pane a pane action opens. */
export const paneOfAction = (action: PaneAction): (typeof PANE_OF)[PaneAction] => PANE_OF[action];

/** A config's `action`, as the current name: an old name is rewritten, anything unknown is null. */
export function headerActionName(value: string): CellAction | AppAction | null {
  if (isCellAction(value) || isAppAction(value)) return value;
  return value === "restart" ? LEGACY_HEADER_ACTIONS.restart : null;
}

/** A shortcut the grid hands to one cell rather than carrying out itself: a pane or what the cell
 *  does by itself. */
export const isGridCellShortcut = (value: KeymapAction): value is PaneAction | CellSelfAction =>
  isCellAction(value) && (isPaneAction(value) || isCellSelfAction(value));
