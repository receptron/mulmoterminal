// Which tab a route belongs to, and the list of tabs opened so far, as pure data: one tab per screen,
// except that each collection and feed page opened gets its own beside its screen's index tab.
import type { PaletteScreen } from "./paletteScreens";

/** One collection or feed: the same slug in two projects is two different ones. */
export interface ScreenItem {
  slug: string;
  project: string | null;
}

export interface ScreenTabTarget {
  key: string;
  screen: PaletteScreen;
  item: ScreenItem | null;
}

export interface ScreenTab extends ScreenTabTarget {
  path: string;
}

export interface TabRoute {
  name?: unknown;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
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

// Rooms and builds are picked from a sidebar beside the open one, so a tab each would add one per click.
const ITEM_ROUTES: ReadonlySet<string> = new Set(["collectionDetail", "feedDetail"]);

/** The screen a route name shows, or null for the terminals and anything else under the screens. */
export function screenOfRoute(name: unknown): PaletteScreen | null {
  return typeof name === "string" && Object.hasOwn(SCREEN_OF_ROUTE, name) ? (SCREEN_OF_ROUTE[name] ?? null) : null;
}

const nonEmpty = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

// A newline cannot be in a slug or a project id, so no two items share a key.
const itemKey = (screen: PaletteScreen, item: ScreenItem): string => [screen, item.project ?? "", item.slug].join("\n");

function itemOfRoute(route: TabRoute): ScreenItem | null {
  if (typeof route.name !== "string" || !ITEM_ROUTES.has(route.name)) return null;
  const slug = nonEmpty(route.params.slug);
  return slug === null ? null : { slug, project: nonEmpty(route.query.project) };
}

/** The tab a route shows in, or null when it is not one of the screens. */
export function tabOfRoute(route: TabRoute): ScreenTabTarget | null {
  const screen = screenOfRoute(route.name);
  if (screen === null) return null;
  const item = itemOfRoute(route);
  return { key: item ? itemKey(screen, item) : screen, screen, item };
}

// An item goes after the last tab of its screen, an index before its screen's first item.
function insertAt(tabs: readonly ScreenTab[], target: ScreenTabTarget): number {
  const sameScreen = tabs.flatMap((tab, at) => (tab.screen === target.screen ? [at] : []));
  if (sameScreen.length === 0) return tabs.length;
  return target.item ? (sameScreen[sameScreen.length - 1] ?? tabs.length - 1) + 1 : (sameScreen[0] ?? 0);
}

/** `tabs` after a visit to `path` in `target`: its tab moves to the new place, or is added beside its screen. */
export function visitTab(tabs: readonly ScreenTab[], target: ScreenTabTarget, path: string): ScreenTab[] {
  if (tabs.some((tab) => tab.key === target.key)) return tabs.map((tab) => (tab.key === target.key ? { ...tab, path } : tab));
  const at = insertAt(tabs, target);
  return [...tabs.slice(0, at), { ...target, path }, ...tabs.slice(at)];
}

/** `tabs` without `key`'s, and the tab to show instead when that one was in front: the one after
 *  it, else the one before, else none (back to the terminals). */
export function closeTab(tabs: readonly ScreenTab[], key: string): { tabs: ScreenTab[]; next: ScreenTab | null } {
  const at = tabs.findIndex((tab) => tab.key === key);
  const rest = tabs.filter((tab) => tab.key !== key);
  return { tabs: rest, next: at < 0 ? null : (rest[at] ?? rest[at - 1] ?? null) };
}
