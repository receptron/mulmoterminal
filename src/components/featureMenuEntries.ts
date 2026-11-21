// What the toolbar's feature menu lists, in order. An entry for a feature that is not set up opens
// onto an empty screen, so it is left out. The Library, Blueprints, Skills, Processes and Usage need no setup, so the menu is never empty.
import type { GatedEntry } from "./gatedToolbarEntries";

export type FeatureMenuEntry = "rooms" | "library" | "blueprints" | "skills" | "processes" | "worklog" | "usage";

export const FEATURE_MENU_ICONS: Record<FeatureMenuEntry, string> = {
  rooms: "forum",
  library: "local_library",
  blueprints: "architecture",
  skills: "auto_stories",
  processes: "memory",
  worklog: "history_edu",
  usage: "data_usage",
};

export function featureMenuEntries(gated: Record<GatedEntry, boolean>): FeatureMenuEntry[] {
  const entries: FeatureMenuEntry[] = [];
  if (gated.rooms) entries.push("rooms");
  entries.push("library", "blueprints", "skills", "processes");
  if (gated.worklog) entries.push("worklog");
  // Usage needs no setup since the retrospective (#3335): the tokens' windows show only where rotation is on.
  entries.push("usage");
  return entries;
}
