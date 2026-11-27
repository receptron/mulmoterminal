// The screens the command palette can go to (#2441), and which of them to offer. A screen for a
// feature that is not set up opens onto nothing, so it follows the toolbar's gating.
import type { GatedEntry } from "../components/gatedToolbarEntries";

export const PALETTE_SCREENS = [
  "terminals",
  "collections",
  "feeds",
  "accounting",
  "files",
  "wiki",
  "prs",
  "rooms",
  "blueprints",
  "worklog",
  "skills",
  "library",
  "processes",
  "usage",
] as const;
export type PaletteScreen = (typeof PALETTE_SCREENS)[number];

/** The icon the toolbar (or the screen's own door) uses for each, so a row reads as that screen. */
export const SCREEN_ICONS: Record<PaletteScreen, string> = {
  terminals: "grid_view",
  collections: "database",
  feeds: "rss_feed",
  accounting: "account_balance",
  files: "folder_open",
  wiki: "menu_book",
  prs: "github:mark-github",
  rooms: "forum",
  blueprints: "architecture",
  worklog: "history_edu",
  skills: "auto_stories",
  library: "local_library",
  processes: "memory",
  usage: "data_usage",
};

/** Each screen's name, from the key its own door already uses, so the two cannot drift apart. */
export const SCREEN_LABEL_KEYS: Record<PaletteScreen, string> = {
  terminals: "tips.toolbar.gridLabel",
  collections: "tips.toolbar.collections",
  feeds: "tips.toolbar.feeds",
  accounting: "tips.overlays.accounting",
  files: "tips.toolbar.files",
  wiki: "tips.toolbar.wiki",
  prs: "tips.toolbar.prs",
  rooms: "featureMenu.items.rooms.label",
  blueprints: "featureMenu.items.blueprints.label",
  worklog: "featureMenu.items.worklog.label",
  skills: "featureMenu.items.skills.label",
  library: "featureMenu.items.library.label",
  processes: "featureMenu.items.processes.label",
  usage: "featureMenu.items.usage.label",
};

const GATED_BY: Partial<Record<PaletteScreen, GatedEntry>> = { prs: "prs", rooms: "rooms", worklog: "worklog" };

export function visibleScreens(gated: Record<GatedEntry, boolean>): PaletteScreen[] {
  return PALETTE_SCREENS.filter((screen) => {
    const entry = GATED_BY[screen];
    return entry === undefined || gated[entry];
  });
}
