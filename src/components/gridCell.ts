// What the grid requires of any cell, whichever kind it is.
//
// Three cell types render in the same grid — a Claude session, a script run, a configured
// launcher — and GridView drives all three identically: it expands one, reorders them, and
// sorts by the attention each reports. That contract belongs to the GRID, not to any cell,
// and it was written out three times with the same comments attached (#646 B1).
//
// Named once so a fourth cell type gets it by construction rather than by copying, and so a
// change to what the grid needs cannot land in two of the three.
import type { AttentionStatus } from "./attentionStatus";
import type { TerminalAgent } from "../../common/sessionAgent";

// The pane showing beside the ENLARGED cell. One slot, three possible occupants, never two at
// once — the row is already `roster | terminal | pane`, and a fourth column leaves the terminal
// unreadable on a laptop. Declared with the rest of the grid's contract because every cell type
// renders the toggles and none of them owns the state.
//
// A LIST the type is derived from, not a union spelled out on its own (the shape
// common/sessionAgent.ts uses): the grid also validates a pane read back from localStorage, and
// while that guard was its own hand-written list, a pane could be added to the union, wired end to
// end, and still fail to reopen after a reload — with nothing failing to say so (CodeRabbit,
// #1749). Adding a member here now reaches the guard by construction.
export const RIGHT_PANES = ["files", "canvas", "tools", "collections", "github", "question", "prompts"] as const;

export type RightPane = (typeof RIGHT_PANES)[number];

export const isRightPane = (value: unknown): value is RightPane => RIGHT_PANES.some((pane) => pane === value);

export interface GridCellProps {
  expanded: boolean;
  // True while SOME cell in the grid is zoomed → this cell is a filmstrip thumbnail
  // (unless it's the zoomed one). Only then does a header-background click zoom it.
  zoomed?: boolean;
  // Whether the file pane is showing beside the enlarged cell, so its toggle can read as
  // pressed. Grid state, not the cell's: only the expanded cell renders the toggle.
  filesOpen?: boolean;
  // Which of the three side panes is showing, so each toggle can read as pressed without three
  // booleans that could disagree. Grid state for the same reason filesOpen is.
  rightPane?: RightPane | null;
  // Whether the ENLARGED cell's session has the drawing tools at all — i.e. whether its
  // directory registered the `render` MCP group. False leaves the Canvas button in place but
  // DISABLED: the pane would open empty, and a button that explains why beats one that isn't
  // there to ask about.
  canvasAvailable?: boolean;
  // Whether the ENLARGED cell's directory registered the `data` MCP group — the one
  // manageCollection belongs to. False HIDES the Collections button rather than disabling it:
  // a directory with no collection tools is not a place where collections are a thing, so there
  // is nothing for a disabled button to explain. See TerminalGrid's `collectionsOpenable` for
  // the one case that keeps it visible anyway (the pane is open and this is its only close).
  collectionsAvailable?: boolean;
  // Drop this cell's expand button. True only while the collection pane is holding it: the pane is
  // an overlay ON TOP of the grid, so the zoom it would set is behind it and the button would look
  // broken (#2001).
  hideExpand?: boolean;
  home: string | null;
  // The server's workspace directory. Grid state, not the cell's: a cell compares its OWN cwd
  // against it to know whether it is the workspace, and then says so in its header badge — the
  // same role-based name the launcher chip uses (WORKSPACE_LABEL in presets.ts).
  //
  // Optional here because only TerminalCell needs it non-null (it also prefills the launch form
  // from it, and re-declares it as required for that); the other two only compare it.
  defaultCwd?: string | null;
}

/** What a cell reports it is RUNNING, both halves. A custom agent is a wrapper around a built-in
 *  CLI, so `agent` alone cannot say whether the session went through one — and a launch that
 *  reported only `agent` would look exactly like the user switching away from the wrapper. */
export interface AgentReport {
  agent: TerminalAgent;
  /** The custom-agent entry this launch used, or null for a plain built-in. */
  customAgent: string | null;
}

export interface GridCellEmits {
  // `open-canvas` and `open-files` come from a control on a cell that may be TILED — the
  // unread-canvas chip, the path menu — and mean: enlarge me AND open that pane, in one gesture.
  // Their `toggle-` siblings act on the cell as it is, so pressed on a tile they only record what
  // that cell should show once it IS enlarged (#1378), which is a different thing to ask for.
  (
    e:
      | "toggle-expand"
      | "new-here"
      | "close"
      | "toggle-files"
      | "toggle-canvas"
      | "toggle-tools"
      | "toggle-collections"
      | "toggle-github"
      | "toggle-prompts"
      | "open-canvas"
      | "open-files",
  ): void;
  // Swap this cell left (-1) or right (+1) in manual sort mode.
  (e: "move", dir: -1 | 1): void;
  // Report activity up so the grid can attention-sort in auto mode.
  (e: "status", value: AttentionStatus): void;
}
