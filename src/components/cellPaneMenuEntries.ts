// What a cell header's two pane menus list, decided from the cell's state alone.
//
// History: what happened in this session — the prompts you sent, the whole conversation, and what
// the agent ran (the Activity timeline, Claude only). Tools: views of things made outside the
// terminal — the tools the agent used, the Canvas, and this folder's collections — and, below
// them, talking to another terminal and restarting the agent.
//
// Every pane opens from a tile as well as from the enlarged cell — beside the tiles, then (#3027).
// A menu with nothing to choose is not shown.
import type { RightPane } from "./gridCell";

export type CellPaneMenuId = "prompts" | "transcript" | "timeline" | "library" | "tools" | "canvas" | "collections" | "talk" | "restart";

export interface CellPaneMenuEntry {
  id: CellPaneMenuId;
  icon: string;
  label: string;
  detail: string;
  disabled: boolean;
  // Whether this pane is the one open beside the cell; undefined for an entry that is not a pane.
  checked?: boolean;
  // Drawn below a divider: an action on the cell, set apart from the views above it.
  separated?: boolean;
}

export interface CellPaneMenuState {
  rightPane: RightPane | null;
  canvasAvailable: boolean;
  collectionsAvailable: boolean;
  timelineAvailable: boolean;
  // Whether this session is one the Library lists (a Claude session), to open there.
  libraryAvailable: boolean;
  restartAvailable: boolean;
  // Whether another terminal is there to talk to, read when the menu opens.
  talkAvailable: boolean;
}

type Translate = (key: string) => string;

const ICONS: Record<CellPaneMenuId, string> = {
  prompts: "outbox",
  transcript: "chat",
  timeline: "timeline",
  library: "local_library",
  tools: "build",
  canvas: "draw",
  collections: "database",
  talk: "forum",
  restart: "restart_alt",
};

function paneEntry(id: CellPaneMenuId, state: CellPaneMenuState, t: Translate): CellPaneMenuEntry {
  return {
    id,
    icon: ICONS[id],
    label: t(`cellMenu.items.${id}.label`),
    detail: t(`cellMenu.items.${id}.detail`),
    disabled: false,
    checked: state.rightPane === id,
  };
}

export function historyEntries(state: CellPaneMenuState, t: Translate): CellPaneMenuEntry[] {
  const entries = [paneEntry("prompts", state, t), paneEntry("transcript", state, t)];
  if (state.timelineAvailable) {
    entries.push({
      id: "timeline",
      icon: ICONS.timeline,
      label: t("cellMenu.items.timeline.label"),
      detail: t("cellMenu.items.timeline.detail"),
      disabled: false,
    });
  }
  // A view elsewhere, so set apart from the panes beside the cell.
  if (state.libraryAvailable) {
    entries.push({
      id: "library",
      icon: ICONS.library,
      label: t("cellMenu.items.library.label"),
      detail: t("cellMenu.items.library.detail"),
      disabled: false,
      separated: true,
    });
  }
  return entries;
}

export function toolEntries(state: CellPaneMenuState, t: Translate): CellPaneMenuEntry[] {
  const entries = [paneEntry("tools", state, t)];
  // Disabled rather than missing when this session has no render MCP: the reason is the fix.
  const canvas = paneEntry("canvas", state, t);
  if (!state.canvasAvailable) entries.push({ ...canvas, disabled: true, detail: t("cellMenu.canvasUnavailable") });
  else entries.push(canvas);
  // Missing rather than disabled without the collection tools — unless its pane is open, because
  // this entry is that pane's only close.
  if (state.collectionsAvailable || state.rightPane === "collections") entries.push(paneEntry("collections", state, t));
  // Actions, not views: drawn below a divider, the first one opening the group.
  const actions = [state.talkAvailable && actionEntry("talk", t), state.restartAvailable && actionEntry("restart", t)].filter((entry) => entry !== false);
  return [...entries, ...actions.map((entry, index) => ({ ...entry, separated: index === 0 }))];
}

function actionEntry(id: "talk" | "restart", t: Translate): CellPaneMenuEntry {
  return { id, icon: ICONS[id], label: t(`cellMenu.items.${id}.label`), detail: t(`cellMenu.items.${id}.detail`), disabled: false };
}

/** A menu is worth an icon only when something in it can be chosen. */
export const hasChoice = (entries: CellPaneMenuEntry[]): boolean => entries.some((entry) => !entry.disabled);
