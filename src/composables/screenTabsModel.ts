// Which screen a route belongs to, and the list of screens opened so far, as pure data: one tab per
// screen, in the order they were first opened, each remembering where inside it the person was.
import type { PaletteScreen } from "./paletteScreens";

export interface ScreenTab {
  screen: PaletteScreen;
  path: string;
}

// The worklog is the wiki filtered to a tag: one screen, so one tab, whichever door opened it.
const SCREEN_OF_ROUTE: Readonly<Record<string, PaletteScreen>> = {
  collections: "collections",
  collectionDetail: "collections",
  feeds: "feeds",
  feedDetail: "feeds",
  accounting: "accounting",
  files: "files",
  wiki: "wiki",
  wikiPage: "wiki",
  wikiGraph: "wiki",
  wikiLint: "wiki",
  github: "prs",
  githubBoard: "prs",
  rooms: "rooms",
  roomView: "rooms",
  blueprints: "blueprints",
  blueprintRun: "blueprints",
  blueprintMarket: "blueprints",
  skills: "skills",
  library: "library",
  processes: "processes",
  usage: "usage",
};

/** The screen a route name shows, or null for the terminals and anything else under the screens. */
export function screenOfRoute(name: unknown): PaletteScreen | null {
  return typeof name === "string" && Object.hasOwn(SCREEN_OF_ROUTE, name) ? (SCREEN_OF_ROUTE[name] ?? null) : null;
}

/** `tabs` after a visit to `path` on `screen`: its tab moves to the new place, or is added last. */
export function visitTab(tabs: readonly ScreenTab[], screen: PaletteScreen, path: string): ScreenTab[] {
  if (!tabs.some((tab) => tab.screen === screen)) return [...tabs, { screen, path }];
  return tabs.map((tab) => (tab.screen === screen ? { screen, path } : tab));
}

/** `tabs` without `screen`'s, and the tab to show instead when that one was in front: the one after
 *  it, else the one before, else none (back to the terminals). */
export function closeTab(tabs: readonly ScreenTab[], screen: PaletteScreen): { tabs: ScreenTab[]; next: ScreenTab | null } {
  const at = tabs.findIndex((tab) => tab.screen === screen);
  const rest = tabs.filter((tab) => tab.screen !== screen);
  return { tabs: rest, next: at < 0 ? null : (rest[at] ?? rest[at - 1] ?? null) };
}
